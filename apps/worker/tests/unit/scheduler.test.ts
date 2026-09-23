import { describe, expect, it, vi } from "vitest";

import type { JobPayload } from "@dp/domain/jobs";

import { SCHEDULES, createScheduler, dueKinds, scheduledPayload } from "@/scheduler";

describe("what is due", () => {
  it("is everything on the first tick", () => {
    expect(dueKinds(new Map(), 0)).toEqual(SCHEDULES.map((schedule) => schedule.kind));
  });

  it("is only what has waited its period", () => {
    const minute = 60_000;
    const last = new Map(SCHEDULES.map((schedule) => [schedule.kind, 0] as const));

    expect(dueKinds(last, 4 * minute)).toEqual([]);
    expect(dueKinds(last, 5 * minute)).toEqual(["productops.reconcile"]);
    expect(dueKinds(last, 60 * minute)).toEqual(["productops.reconcile", "fx.refresh", "ratelimit.purge"]);
  });
});

describe("the scheduler", () => {
  it("enqueues due kinds with a fresh correlation id and remembers when", async () => {
    let now = 0;
    const enqueue = vi.fn<(payload: JobPayload) => Promise<void>>(async () => undefined);
    const scheduler = createScheduler({ enqueue, now: () => now });

    const first = await scheduler.tick();
    expect(first).toHaveLength(SCHEDULES.length);
    expect(enqueue).toHaveBeenCalledTimes(SCHEDULES.length);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({ source: "scheduler" });

    now = 60_000;
    const second = await scheduler.tick();
    expect(second).toEqual([]);
  });

  it("builds a payload the envelope accepts", () => {
    expect(scheduledPayload("checkpoints.prune")).toMatchObject({
      kind: "checkpoints.prune",
      olderThanDays: 30,
      source: "scheduler",
    });
  });
});
