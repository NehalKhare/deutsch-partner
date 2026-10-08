import { describe, expect, it, vi } from "vitest";

import { jobPayloadSchema, type JobPayload } from "@dp/domain/jobs";
import type { AdvanceResult } from "@dp/product-ops/results";

import type { WorkerContext } from "@/composition";
import type { JobRun } from "@/handlers/types";

/**
 * The drive job's end is where an operator hears about a run: parked on
 * them, failed, or done. The graph itself is tested in its package; here it
 * is a fake that ends however the test says.
 */

const result = vi.hoisted(() => ({ current: null as AdvanceResult | null }));

vi.mock("@dp/product-ops/graph/graph", () => ({
  driveRunGraph: vi.fn(async () => result.current),
}));

const { driveRun } = await import("@/handlers/drive");

const RUN = "4b5a6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d";

const payload = () =>
  jobPayloadSchema.parse({
    kind: "productops.drive",
    runId: RUN,
    review: null,
    correlationId: "00000000-0000-4000-8000-000000000000",
    source: "ops",
  }) as Extract<JobPayload, { kind: "productops.drive" }>;

function harness(events: Array<{ stage: string; status: string; detail: Record<string, unknown> }> = []) {
  const notify = vi.fn(async () => {});
  const context = {
    workflow: {},
    notifications: { notify },
    runs: { listEvents: vi.fn(async () => ({ ok: true, data: events })) },
  } as unknown as WorkerContext;
  const run = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as JobRun;
  return { notify, context, run };
}

const ended = (status: AdvanceResult["status"], stage: AdvanceResult["stage"], detail: string | null = null): AdvanceResult => ({
  status,
  stage,
  outcome: null,
  costEur: 0,
  detail,
});

describe("driveRun tells the operators", () => {
  it("that a run is waiting on them, naming the gate", async () => {
    result.current = ended("waiting", "human_review");
    const { notify, context, run } = harness();

    const outcome = await driveRun(payload(), context, run);

    expect(outcome).toMatchObject({ status: "done" });
    expect(notify).toHaveBeenCalledWith({ kind: "productops.review_needed", runId: RUN, stage: "human_review" });
  });

  it("that a run failed, at the stage the timeline names, with the code", async () => {
    result.current = ended("failed", "failed", "budget_exhausted");
    const { notify, context, run } = harness([
      { stage: "research", status: "started", detail: {} },
      { stage: "research", status: "failed", detail: {} },
      { stage: "failed", status: "failed", detail: { from: "research" } },
    ]);

    await driveRun(payload(), context, run);

    expect(notify).toHaveBeenCalledWith({
      kind: "productops.run_failed",
      runId: RUN,
      stage: "research",
      detail: "budget_exhausted",
    });
  });

  it("that a run completed", async () => {
    result.current = ended("finished", "completed");
    const { notify, context, run } = harness();

    await driveRun(payload(), context, run);

    expect(notify).toHaveBeenCalledWith({ kind: "productops.run_completed", runId: RUN });
  });

  it("nothing when a run merely advanced, was deferred to the coder, lost a race or was rejected", async () => {
    for (const end of [ended("advanced", "prd"), ended("deferred", "implementation"), ended("raced", "prd"), ended("finished", "rejected")]) {
      result.current = end;
      const { notify, context, run } = harness();

      await driveRun(payload(), context, run);

      expect(notify).not.toHaveBeenCalled();
    }
  });

  it("nothing when the store was unavailable, which is a retry and not an end", async () => {
    result.current = ended("unavailable", null);
    const { notify, context, run } = harness();

    const outcome = await driveRun(payload(), context, run);

    expect(outcome).toEqual({ status: "retry", errorCode: "store_unavailable" });
    expect(notify).not.toHaveBeenCalled();
  });
});
