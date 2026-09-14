import { describe, expect, it } from "vitest";

import type { ProductOpsRun, RunEvent } from "@/domain/product-ops";
import { maxDuration } from "@/app/api/operations/product/[runId]/events/route";
import {
  STREAM_MAX_MS,
  sseFrame,
  streamRunEvents,
  toEventStream,
} from "@/lib/api/product-ops-stream";
import { fail, ok, repositoryError } from "@/repositories/errors";

/**
 * The live feed's server half.
 *
 * A generator over two repository reads, driven here with a scripted store
 * and a sleep that advances a fake clock, so what is asserted is the framing
 * and the stopping: each new timeline row once and with its id, the run's row
 * when it moves, a heartbeat when nothing did, and an end when the run
 * leaves the server's hands, when the browser goes, or when the connection
 * has been open long enough.
 */

const RUN_ID = "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f";
const AT = new Date("2026-09-10T12:00:00.000Z");

function run(over: Partial<ProductOpsRun> = {}): ProductOpsRun {
  return {
    id: RUN_ID,
    runType: "manual_market_scan",
    status: "running",
    currentStage: "research",
    operatorIdHash: "hash-operator",
    requestId: null,
    errorCode: null,
    metadata: {},
    brief: null,
    startedAt: AT,
    completedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  } as ProductOpsRun;
}

function event(id: number, over: Partial<RunEvent> = {}): RunEvent {
  return {
    id,
    runId: RUN_ID,
    stage: "research",
    status: "progress",
    detail: { tool: "search_market", ok: true },
    createdAt: AT,
    ...over,
  };
}

/** A store whose rows appear tick by tick, and a clock the sleep advances. */
function harness(script: {
  runs: readonly (ProductOpsRun | null)[];
  events: readonly (readonly RunEvent[])[];
}) {
  let tick = 0;
  let clock = 0;
  const frames: string[] = [];

  const deps = {
    runs: {
      getRun: async () => {
        const row = script.runs[Math.min(tick, script.runs.length - 1)];
        return row === null ? fail(repositoryError("unavailable")) : ok(row);
      },
      listEventsAfter: async (_runId: string, afterId: number) => {
        const rows = script.events[Math.min(tick, script.events.length - 1)] ?? [];
        return ok(rows.filter((row) => row.id > afterId));
      },
    },
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
      tick += 1;
    },
  };

  return {
    deps,
    frames,
    async drain(request: Partial<Parameters<typeof streamRunEvents>[1]> = {}) {
      for await (const frame of streamRunEvents(deps, {
        runId: RUN_ID,
        afterId: 0,
        tickMs: 1_000,
        maxMs: 10_000,
        ...request,
      })) {
        frames.push(frame);
      }
      return frames;
    },
  };
}

const kinds = (frames: readonly string[]) =>
  frames.map((frame) => frame.startsWith(":") ? "heartbeat" : /^event: (\w+)/.exec(frame)?.[1]);

describe("the frames", () => {
  it("writes an event, its id and one JSON line, terminated by a blank line", () => {
    expect(sseFrame("timeline", { a: 1 }, 7)).toBe('event: timeline\nid: 7\ndata: {"a":1}\n\n');
    expect(sseFrame("done", { reason: "settled" })).toBe(
      'event: done\ndata: {"reason":"settled"}\n\n',
    );
  });
});

describe("what one connection sends", () => {
  it("opens with where the run stands and sends each new row once, with its id", async () => {
    const { drain } = harness({
      runs: [run(), run(), run({ currentStage: "human_review", status: "awaiting_review" })],
      events: [[event(1)], [event(1), event(2)], [event(1), event(2), event(3, { status: "ok" })]],
    });

    const frames = await drain();

    expect(kinds(frames)).toEqual([
      "timeline", "run",
      "timeline",
      "timeline", "run", "done",
    ]);
    const ids = frames.filter((f) => f.startsWith("event: timeline")).map((f) => /id: (\d+)/.exec(f)?.[1]);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("sends the timeline entry the detail page renders, not the raw row", async () => {
    const { drain } = harness({
      runs: [run({ currentStage: "human_review", status: "awaiting_review" })],
      events: [[event(1, { detail: { tool: "search_market", ok: true, costEur: 0.01 } })]],
    });

    const [timeline] = await drain();
    const data = JSON.parse(timeline.split("data: ")[1]);

    expect(data).toMatchObject({
      id: 1,
      stage: "research",
      status: "progress",
      entered: false,
      costEur: 0.01,
      errorCode: null,
      at: AT.toISOString(),
    });
    expect(data.notes).toEqual(
      expect.arrayContaining([{ label: "tool", value: "search_market" }]),
    );
  });

  it("starts after the id the browser last saw", async () => {
    const { drain } = harness({
      runs: [run({ currentStage: "failed", status: "failed" })],
      events: [[event(1), event(2), event(3)]],
    });

    const frames = await drain({ afterId: 2 });

    expect(frames.filter((f) => f.startsWith("event: timeline"))).toHaveLength(1);
    expect(frames[0]).toContain("id: 3");
  });

  it("heartbeats through a quiet tick and says so with a comment, not an event", async () => {
    const { drain } = harness({
      runs: [run(), run(), run({ currentStage: "completed", status: "completed" })],
      events: [[], [], []],
    });

    const frames = await drain();

    expect(kinds(frames)).toEqual(["run", "heartbeat", "run", "done"]);
  });

  it("re-sends the run only when its row moved", async () => {
    const later = new Date(AT.getTime() + 5_000);
    const { drain } = harness({
      runs: [run(), run(), run({ updatedAt: later }), run({ currentStage: "completed", status: "completed" })],
      events: [[], [], [], []],
    });

    const frames = await drain();

    expect(kinds(frames).filter((k) => k === "run")).toHaveLength(3);
  });
});

describe("what ends a connection", () => {
  it("ends once the run leaves the server's hands, and says the run settled", async () => {
    const { drain } = harness({
      runs: [run({ currentStage: "plan_review", status: "awaiting_review" })],
      events: [[]],
    });

    const frames = await drain();

    expect(frames.at(-1)).toBe('event: done\ndata: {"reason":"settled"}\n\n');
  });

  it("ends when the browser goes away, without a done frame", async () => {
    const controller = new AbortController();
    const { deps, frames } = harness({ runs: [run()], events: [[]] });
    deps.sleep = async () => controller.abort();

    for await (const frame of streamRunEvents(deps, {
      runId: RUN_ID,
      afterId: 0,
      signal: controller.signal,
      tickMs: 1_000,
    })) {
      frames.push(frame);
    }

    // The opening run frame went out; the abort ended the wait before a
    // second tick, and nothing said "done" because nothing had settled.
    expect(kinds(frames)).toEqual(["run"]);
  });

  it("ends when it has been open long enough, so the browser reconnects with its last id", async () => {
    const { drain } = harness({ runs: [run()], events: [[]] });

    const frames = await drain({ tickMs: 4_000, maxMs: 10_000 });

    // Ticks at 0, 4, 8; the one at 12 is past the deadline.
    expect(kinds(frames)).toEqual(["run", "heartbeat", "heartbeat"]);
    expect(frames.at(-1)).not.toContain("done");
  });

  it("ends with an unavailable reason when the run cannot be read", async () => {
    const { drain } = harness({ runs: [null], events: [[]] });

    const frames = await drain();

    expect(frames).toEqual(['event: done\ndata: {"reason":"unavailable"}\n\n']);
  });
});

describe("as a response body", () => {
  it("encodes every frame and closes when the generator is done", async () => {
    const { deps } = harness({
      runs: [run({ currentStage: "completed", status: "completed" })],
      events: [[]],
    });

    const body = toEventStream(
      streamRunEvents(deps, { runId: RUN_ID, afterId: 0, tickMs: 1, maxMs: 1_000 }),
    );
    const text = await new Response(body).text();

    expect(text).toContain("event: run\n");
    expect(text.endsWith('event: done\ndata: {"reason":"settled"}\n\n')).toBe(true);
  });
});

describe("the route's own ceiling", () => {
  it("outlives the stream by enough to close it cleanly", () => {
    // The segment config has to be a literal, so this is what keeps the two
    // numbers from drifting apart.
    expect(maxDuration * 1000).toBeGreaterThan(STREAM_MAX_MS);
    expect(maxDuration * 1000 - STREAM_MAX_MS).toBeLessThanOrEqual(60_000);
  });
});
