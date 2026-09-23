import { describe, expect, it, vi } from "vitest";

import { jobPayloadSchema, type JobPayload } from "@dp/domain/jobs";

import { rebuildCostRollup } from "@/handlers/cost-rollup";
import type { WorkerContext } from "@/composition";
import type { JobRun } from "@/handlers/types";

/**
 * The job that fills the spend calendar.
 *
 * What is worth asserting is the window it asks for, because that is the
 * whole design: the scheduled job hands the database no bounds at all and
 * lets it decide, which is what makes the first run after deploy backfill the
 * ledger instead of rolling up today and leaving the year empty behind it.
 */

const payload = (over: Record<string, unknown> = {}) =>
  jobPayloadSchema.parse({
    kind: "cost.rollup",
    correlationId: "00000000-0000-4000-8000-000000000000",
    source: "scheduler",
    ...over,
  }) as Extract<JobPayload, { kind: "cost.rollup" }>;

function harness(response: { data?: unknown; error?: unknown } = { data: 12 }) {
  const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({
    data: response.data ?? null,
    error: response.error ?? null,
  }));
  const context = { client: { rpc } } as unknown as WorkerContext;
  const run = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as JobRun;

  return { rpc, context, run };
}

describe("rebuildCostRollup", () => {
  it("leaves the window to the database when nothing was asked for", async () => {
    const { rpc, context, run } = harness();

    const outcome = await rebuildCostRollup(payload(), context, run);

    expect(outcome).toMatchObject({ status: "done", detail: { rows: 12 } });
    // A null lower bound is what triggers the backfill on an empty rollup and
    // the two-day tail on a current one. Sending a date here instead would
    // mean the calendar only ever starts from the day this job was deployed.
    expect(rpc).toHaveBeenCalledWith(
      "rebuild_cost_rollup_daily",
      expect.objectContaining({ p_from: null }),
    );
  });

  it("bounds the window when an operator names one", async () => {
    const { rpc, context, run } = harness();

    await rebuildCostRollup(payload({ sinceDays: 7 }), context, run);

    const args = rpc.mock.calls[0]?.[1] as unknown as { p_from: string; p_to: string };
    expect(args.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Seven days *inclusive* of today, so "last 7 days" on the screen and
    // "sinceDays: 7" in the queue mean the same seven days.
    const span =
      (Date.parse(`${args.p_to}T00:00:00Z`) -
        Date.parse(`${args.p_from}T00:00:00Z`)) /
      86_400_000;
    expect(span).toBe(6);
  });

  it("retries rather than fails when the store is unavailable", async () => {
    const { context, run } = harness({ error: { message: "down" } });

    // The ledger is append-only, so a later attempt sees everything this one
    // would have. Nothing is lost by waiting, and a failed job needs a human.
    expect(await rebuildCostRollup(payload(), context, run)).toMatchObject({
      status: "retry",
      errorCode: "store_unavailable",
    });
  });
});
