import { limiterFor } from "@/lib/api/rate-limit";
import { operatorForRequest } from "@/lib/auth/require-operator";
import { readOpsFeed } from "@/lib/notifications";

/**
 * GET /api/notifications
 *
 * The bell's poll: the unread count and the newest few. Operator-only, and
 * 404 rather than 403 for everyone else — the same answer every operator
 * surface gives, for the same reason. Rate limited per operator, uncached.
 */
export const runtime = "nodejs";

const notFound = () => new Response(null, { status: 404 });

export async function GET(): Promise<Response> {
  const operator = await operatorForRequest("/api/notifications");
  if (!operator) return notFound();

  const decision = await limiterFor("ops_notifications").check(operator.hash);
  if (!decision.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "retry-after": String(Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000))) },
    });
  }

  return new Response(JSON.stringify(await readOpsFeed()), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
