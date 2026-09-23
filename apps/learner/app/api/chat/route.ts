import { randomUUID } from "node:crypto";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import {
  chatErrorResponse,
  handleChatTurn,
  toReadableStream,
} from "@/lib/api/chat";
import { createRequestGraph, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";

/**
 * POST /api/chat
 *
 * Thin on purpose. The framework's job is to read a session, read a body, and
 * turn a result into a response; the turn itself is in lib/api/chat.ts, where
 * it can be tested without standing up a server.
 *
 * Node runtime, not edge: the gateway uses node:crypto for the pseudonymous
 * learner id, and the after-stream work has to outlive the last chunk.
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

  // 1. Authenticate. Derived from a verified token, never from the body.
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) {
    const { status, message } = chatErrorResponse("unauthenticated");
    return json({ error: "unauthenticated", message }, status);
  }

  const userIdHash = pseudonymFor(learnerId);

  // 2. Rate limit, keyed on the pseudonym rather than the learner id, so the
  //    limiter's keys are no more identifying than the logs are.
  const decision = await limiterFor("chat").check(userIdHash);
  if (!decision.allowed) {
    const { status, message } = chatErrorResponse("rate_limited");
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
    const { status, message } = chatErrorResponse("invalid_body");
    return json({ error: "invalid_body", message }, status);
  }

  const { deps } = await createRequestGraph();
  const result = await handleChatTurn(body, { learnerId, userIdHash, requestId }, deps);

  if (!result.ok) {
    const { status, message } = chatErrorResponse(result.error);
    return json({ error: result.error, message, requestId }, status);
  }

  // Where the learner now stands, said before the first byte. The theme is
  // URI-encoded because header values are ASCII and the curriculum is not.
  const position = result.outcome.position;

  return new Response(toReadableStream(result.outcome), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...(position
        ? {
            "x-mini-level": String(position.miniLevel),
            "x-mini-level-theme": encodeURIComponent(position.theme),
          }
        : {}),
    },
  });
}
