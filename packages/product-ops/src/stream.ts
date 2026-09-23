import { stageOwner, type ProductOpsStage } from "@dp/domain/product-ops";
import {
  liveTimelineEventFrom,
  timelineEntries,
  type LiveRunEvent,
} from "./view";
import type { ProductOpsRepository } from "./repository";

/**
 * A run's timeline, as it happens.
 *
 * The pipeline is driven in the background after a response has gone out, and
 * on a deployment with more than one instance the process driving a run is
 * not the process an operator's browser is talking to. So there is no
 * in-memory channel to stream from: the timeline in Postgres is the one place
 * every progress row lands, and this reads it forward from wherever the
 * browser got to, on a short tick, and ends when the run leaves the server's
 * hands. Server-Sent Events rather than a bespoke framing, because the
 * browser's EventSource reconnects on its own and carries the last id it saw.
 *
 * What goes over the wire is the timeline entry the detail page already
 * renders, and nothing the timeline does not carry. Tool arguments, tool
 * results and model replies never reached the timeline, so they cannot reach
 * this.
 */

/** How often to look. One indexed range scan and one row read per tick. */
export const STREAM_TICK_MS = 1_500;

/**
 * The longest one connection stays open. Under the route's own maxDuration,
 * so the server closes the stream cleanly and the browser reconnects with the
 * id it saw last rather than being cut off mid-frame.
 */
export const STREAM_MAX_MS = 270_000;

export interface RunStreamDeps {
  readonly runs: Pick<ProductOpsRepository, "getRun" | "listEventsAfter">;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RunStreamRequest {
  readonly runId: string;
  /** The last event id the browser saw, from its Last-Event-ID header. */
  readonly afterId: number;
  readonly signal?: AbortSignal;
  readonly tickMs?: number;
  readonly maxMs?: number;
}

/** One SSE frame. The id is what the browser echoes back on reconnect. */
export function sseFrame(event: string, data: unknown, id?: number): string {
  const lines = [`event: ${event}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

/** A comment frame: keeps the connection warm through proxies, says nothing. */
const HEARTBEAT = ": tick\n\n";

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Whether anybody server-side is still expected to move this run. */
const stillWorking = (stage: ProductOpsStage): boolean => stageOwner(stage) === "server";

/**
 * The frames, in order, until the run stops being the server's to move, the
 * browser goes away, or the connection has been open long enough.
 *
 * Every tick sends what is new: the timeline rows after the last one sent,
 * each with its id, and the run's row when it has moved. A quiet tick sends a
 * heartbeat so the connection is known to be alive. A run that cannot be read
 * ends the stream with a `done` frame saying so; the browser shows the board
 * as it stands and does not reconnect.
 */
export async function* streamRunEvents(
  deps: RunStreamDeps,
  request: RunStreamRequest,
): AsyncGenerator<string, void, undefined> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const tickMs = request.tickMs ?? STREAM_TICK_MS;
  const deadline = now() + (request.maxMs ?? STREAM_MAX_MS);

  let lastId = request.afterId;
  let lastRun: LiveRunEvent | null = null;

  while (!request.signal?.aborted && now() < deadline) {
    const loaded = await deps.runs.getRun(request.runId);
    if (!loaded.ok) {
      yield sseFrame("done", { reason: "unavailable" });
      return;
    }

    const run: LiveRunEvent = {
      stage: loaded.data.currentStage,
      status: loaded.data.status,
      errorCode: loaded.data.errorCode,
      updatedAt: loaded.data.updatedAt.toISOString(),
    };

    const events = await deps.runs.listEventsAfter(request.runId, lastId);
    if (!events.ok) {
      yield sseFrame("done", { reason: "unavailable" });
      return;
    }

    let sent = false;
    for (const entry of timelineEntries(events.data)) {
      yield sseFrame("timeline", liveTimelineEventFrom(entry), entry.id);
      lastId = Math.max(lastId, entry.id);
      sent = true;
    }

    const moved =
      lastRun === null ||
      lastRun.stage !== run.stage ||
      lastRun.status !== run.status ||
      lastRun.updatedAt !== run.updatedAt;
    if (moved) {
      yield sseFrame("run", run);
      lastRun = run;
      sent = true;
    }

    if (!stillWorking(run.stage)) {
      yield sseFrame("done", { reason: "settled" });
      return;
    }

    if (!sent) yield HEARTBEAT;

    await sleep(tickMs, request.signal);
  }
}

/** The generator as a Response body, closed when the browser goes away. */
export function toEventStream(
  frames: AsyncGenerator<string, void, undefined>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await frames.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch {
        // The generator threw past its own handling: the consumer sees the
        // stream end, and the board it already has is still right.
        controller.close();
      }
    },
    async cancel() {
      await frames.return();
    },
  });
}
