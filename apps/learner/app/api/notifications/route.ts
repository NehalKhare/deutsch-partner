import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { pseudonymOrUnavailable } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { readOwnFeed } from "@/lib/notifications/server";

/**
 * GET /api/notifications
 *
 * The bell's poll: the unread count and the newest few, as the signed-in
 * learner. Thin: authenticate, rate limit, read, answer. The read runs under
 * Row Level Security, so there is no learner id in the request and nothing
 * here to get wrong about whose rows these are.
 *
 * 401 rather than a redirect, because the caller is a fetch; no-store,
 * because a cached feed is a stale badge.
 */
export const runtime = "nodejs";

const json = (body: unknown, status: number, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export async function GET(): Promise<Response> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) return json({ error: "unauthenticated" }, 401);

  const decision = await limiterFor("notifications").check(pseudonymOrUnavailable(learnerId));
  if (!decision.allowed) {
    return json({ error: "rate_limited" }, 429, {
      "retry-after": String(Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000))),
    });
  }

  return json(await readOwnFeed(), 200);
}
