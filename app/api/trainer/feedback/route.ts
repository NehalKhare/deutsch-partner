import { randomUUID } from "node:crypto";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { createTrainerFeedbackGraph, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import {
  handleTrainerFeedback,
  trainerFeedbackErrorResponse,
} from "@/lib/api/trainer-feedback";

/**
 * POST /api/trainer/feedback
 *
 * A vote on one trainer reply. Thin, like /api/trainer: authenticate, rate
 * limit, parse, hand off. The logic — folding the vote into the learner's
 * coaching profile — lives in lib/api/trainer-feedback.ts, where it is tested
 * without a server. No model is called here, so no budget check either: the
 * only thing this endpoint can spend is two small writes.
 */
export const runtime = "nodejs";

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) {
    const { status, message } = trainerFeedbackErrorResponse("unauthenticated");
    return json({ error: "unauthenticated", message }, status);
  }

  const userIdHash = pseudonymFor(learnerId);

  const decision = limiterFor("trainer_feedback").check(userIdHash);
  if (!decision.allowed) {
    const { status, message } = trainerFeedbackErrorResponse("rate_limited");
    return json({ error: "rate_limited", message }, status, {
      "retry-after": String(
        Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000)),
      ),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const { status, message } = trainerFeedbackErrorResponse("invalid_body");
    return json({ error: "invalid_body", message }, status);
  }

  const { deps } = await createTrainerFeedbackGraph();
  const result = await handleTrainerFeedback(
    body,
    { learnerId, userIdHash, requestId },
    deps,
  );

  if (!result.ok) {
    const { status, message } = trainerFeedbackErrorResponse(result.error);
    return json({ error: result.error, message, requestId }, status);
  }

  return json(result.payload, 200, { "x-request-id": requestId });
}
