import { randomUUID } from "node:crypto";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import {
  handleScenarioSearch,
  scenarioErrorResponse,
} from "@/lib/api/scenarios";
import { createScenarioSearch, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";

/**
 * POST /api/scenarios/search
 *
 * Natural-language search over the scenario corpus. A POST rather than a GET
 * because the query is learner content: request bodies stay out of access
 * logs and browser histories in a way query strings do not.
 *
 * Thin on purpose: the search itself lives in lib/api/scenarios.ts, where it
 * is tested without a server.
 */

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  // 1. Authenticate. Derived from a verified token, never from the body.
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) {
    const { status, message } = scenarioErrorResponse("unauthenticated");
    return json({ error: "unauthenticated", message }, status);
  }

  const userIdHash = pseudonymFor(learnerId);

  // 2. Rate limit. Each search embeds the query — a model call with a bill.
  const decision = await limiterFor("search").check(userIdHash);
  if (!decision.allowed) {
    const { status, message } = scenarioErrorResponse("rate_limited");
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
    const { status, message } = scenarioErrorResponse("invalid_body");
    return json({ error: "invalid_body", message }, status);
  }

  const { deps } = await createScenarioSearch();
  const result = await handleScenarioSearch(body, { userIdHash, requestId }, deps);

  if (!result.ok) {
    const { status, message } = scenarioErrorResponse(result.error);
    return json({ error: result.error, message, requestId }, status);
  }

  return json({ results: result.results }, 200, { "x-request-id": requestId });
}
