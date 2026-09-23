import type { JobPayload } from "@dp/domain/jobs";
import { driveRunGraph } from "@dp/product-ops/graph/graph";

import type { JobHandler } from "./types";

type Drive = Extract<JobPayload, { kind: "productops.drive" }>;

/**
 * Drives one run from where it stands until it parks at a gate, defers to
 * the coding worker, ends, fails, or loses a race.
 *
 * The same graph the server once drove after a response. Every stage checks
 * for its own output first and every transition is a compare-and-set, so a
 * second worker holding a duplicate job finds the run already moved and
 * reports 'raced'; nothing is decided twice.
 */
export const driveRun: JobHandler<Drive> = async (payload, context, run) => {
  const result = await driveRunGraph(context.workflow, payload.runId, payload.review);

  run.logger.info("worker.run_driven", {
    runId: payload.runId,
    status: result.status,
    stage: result.stage,
    costEur: result.costEur,
    detail: result.detail,
  });

  // The store could not be read or written; nothing was decided. Later.
  if (result.status === "unavailable") return { status: "retry", errorCode: "store_unavailable" };

  // Everything else is the run's business now: a failed run is an operator's
  // retry, not the queue's.
  return { status: "done", detail: { status: result.status, stage: result.stage } };
};
