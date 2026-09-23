import { randomUUID } from "node:crypto";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import {
  handleTrainerTurn,
  trainerErrorResponse,
} from "@/lib/api/trainer";
import { createTrainerGraph, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";

/**
 * POST /api/trainer
 *
 * Thin on purpose, exactly like /api/chat: read a session, read a body, turn
 * a result into a response. The agent loop itself lives in lib/api/trainer.ts
 * and lib/trainer/, where it is tested without a server.
 *
 * Node runtime because the loop outlives any edge budget, and a generous
 * maxDuration because one request is up to seven model calls plus tool
 * fetches. (Hosting plans with a lower ceiling cut the loop short at their
 * own limit; the step cap keeps the worst case bounded either way.)
 */
export const runtime = "nodejs";
export const maxDuration = 120;

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  // 1. Authenticate. Derived from a verified token, never from the body.
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) {
    const { status, message } = trainerErrorResponse("unauthenticated");
    return json({ error: "unauthenticated", message }, status);
  }

  const userIdHash = pseudonymFor(learnerId);

  // 2. Rate limit, on the pseudonym, tighter than chat: each request is a
  //    whole agent loop rather than one call.
  const decision = await limiterFor("trainer").check(userIdHash);
  if (!decision.allowed) {
    const { status, message } = trainerErrorResponse("rate_limited");
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
    const { status, message } = trainerErrorResponse("invalid_body");
    return json({ error: "invalid_body", message }, status);
  }

  const { deps } = await createTrainerGraph();
  const result = await handleTrainerTurn(body, { learnerId, userIdHash, requestId }, deps);

  if (!result.ok) {
    const { status, message } = trainerErrorResponse(result.error);
    return json({ error: result.error, message, requestId }, status);
  }

  return json(result.payload, 200, { "x-request-id": requestId });
}
