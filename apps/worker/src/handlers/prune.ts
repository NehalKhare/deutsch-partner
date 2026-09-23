import type { JobPayload } from "@dp/domain/jobs";

import type { JobHandler } from "./types";

type Prune = Extract<JobPayload, { kind: "checkpoints.prune" }>;

/** Retires the graph checkpoints of runs that ended a while ago. */
export const pruneCheckpoints: JobHandler<Prune> = async (payload, context, run) => {
  const pruned = await context.runs.pruneCheckpoints(payload.olderThanDays);
  if (!pruned.ok) return { status: "retry", errorCode: "store_unavailable" };

  run.logger.info("productops.checkpoints_pruned", {
    olderThanDays: payload.olderThanDays,
    pruned: pruned.data,
  });

  return { status: "done", detail: { pruned: pruned.data } };
};
