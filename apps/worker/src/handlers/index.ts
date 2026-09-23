import type { JobPayload } from "@dp/domain/jobs";

import type { WorkerContext } from "../composition";
import { rebuildCostRollup } from "./cost-rollup";
import { driveRun } from "./drive";
import { refreshFxRate } from "./fx-refresh";
import { implementProposal } from "./implement";
import { ingestKnowledge } from "./ingest";
import { snapshotPricing } from "./pricing-snapshot";
import { pruneCheckpoints } from "./prune";
import { purgeRateLimits } from "./purge";
import { reconcileRuns } from "./reconcile";
import type { HandlerOutcome, JobRun } from "./types";

/** One job, dispatched on its kind. The switch is exhaustive by construction. */
export async function handleJob(
  payload: JobPayload,
  context: WorkerContext,
  run: JobRun,
): Promise<HandlerOutcome> {
  switch (payload.kind) {
    case "productops.drive":
      return driveRun(payload, context, run);
    case "productops.implement":
      return implementProposal(payload, context, run);
    case "productops.reconcile":
      return reconcileRuns(payload, context, run);
    case "fx.refresh":
      return refreshFxRate(payload, context, run);
    case "pricing.snapshot":
      return snapshotPricing(payload, context, run);
    case "checkpoints.prune":
      return pruneCheckpoints(payload, context, run);
    case "ingest.knowledge":
      return ingestKnowledge(payload, context, run);
    case "ratelimit.purge":
      return purgeRateLimits(payload, context, run);
    case "cost.rollup":
      return rebuildCostRollup(payload, context, run);
  }
}
