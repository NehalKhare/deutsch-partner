import { z } from "zod";

import { createProductOpsReader, pseudonymFor } from "@/lib/api/composition";
import { streamRunEvents, toEventStream } from "@/lib/api/product-ops-stream";
import { limiterFor } from "@/lib/api/rate-limit";
import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";

/**
 * GET /api/operations/product/:runId/events
 *
 * The live feed for one run, as Server-Sent Events. Thin, like every route
 * here: authenticate, gate, read a header, hand the rest to
 * lib/api/product-ops-stream.ts, where it is tested without a server.
 *
 * Operator-only, and 404 rather than 403 for everyone else — the same answer
 * the board gives, for the same reason: confirming the route exists tells
 * somebody there is one worth finding. The run id is validated as a UUID
 * before anything is read, and the tables behind it are reachable by the
 * secret key alone.
 *
 * Node runtime, with a maxDuration a little above the stream's own cap so the
 * server closes the connection deliberately and the browser reconnects with
 * the last id it saw.
 */
export const runtime = "nodejs";
// A literal, because the framework reads segment config statically. Thirty
// seconds above STREAM_MAX_MS in lib/api/product-ops-stream.ts; a test holds
// the two together.
export const maxDuration = 300;

const notFound = () => new Response(null, { status: 404 });

const lastEventIdSchema = z.coerce.number().int().min(0).catch(0);

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly runId: string }> },
): Promise<Response> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId || !isOperator(learnerId)) return notFound();

  const runId = z.uuid().safeParse((await params).runId);
  if (!runId.success) return notFound();

  const decision = limiterFor("product_ops_events").check(pseudonymFor(learnerId));
  if (!decision.allowed) {
    return new Response(null, {
      status: 429,
      headers: {
        "retry-after": String(
          Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000)),
        ),
      },
    });
  }

  const { runs } = createProductOpsReader();
  const afterId = lastEventIdSchema.parse(request.headers.get("last-event-id") ?? "0");

  const frames = streamRunEvents(
    { runs },
    { runId: runId.data, afterId, signal: request.signal },
  );

  return new Response(toEventStream(frames), {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
