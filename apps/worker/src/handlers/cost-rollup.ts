import type { JobPayload } from "@dp/domain/jobs";

import type { JobHandler } from "./types";

type CostRollup = Extract<JobPayload, { kind: "cost.rollup" }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC. A ledger day is not the operator's local day. */
const dayKey = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Rebuilds the daily cost rollup the spend calendar reads.
 *
 * The window is the database's business, not this handler's: left to itself
 * the function redoes the newest day it holds plus the one before it, and
 * backfills the entire ledger when the rollup is empty. So the scheduled job
 * passes nothing and the first run after deploy fills in whatever history
 * exists. `sinceDays` is for an operator who knows a particular window needs
 * redoing — after a retention purge, or a day that was rolled up while the
 * ledger was still being written.
 *
 * Idempotent, which the scheduler needs rather than merely likes: it is an
 * in-process clock, so two replicas can tick the same hour, and the rebuild
 * recomputes a day from the ledger rather than adding to it.
 */
export const rebuildCostRollup: JobHandler<CostRollup> = async (
  payload,
  context,
  run,
) => {
  const to = new Date();
  const from =
    payload.sinceDays === null
      ? null
      : dayKey(new Date(to.getTime() - (payload.sinceDays - 1) * DAY_MS));

  const outcome = await context.client.rpc("rebuild_cost_rollup_daily", {
    p_from: from,
    p_to: dayKey(to),
  });

  // A rollup that could not be rebuilt is retried rather than failed: the
  // table it reads is append-only, so the next attempt sees everything this
  // one would have and nothing is lost by waiting.
  if (outcome.error) return { status: "retry", errorCode: "store_unavailable" };

  const rows = Number(outcome.data ?? 0);
  run.logger.info("cost.rollup_rebuilt", { rows, sinceDays: payload.sinceDays });

  return { status: "done", detail: { rows } };
};
