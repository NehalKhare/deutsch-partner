import { randomUUID } from "node:crypto";

import type { JobPayload } from "@dp/domain/jobs";

import type { JobHandler } from "./types";

type Reconcile = Extract<JobPayload, { kind: "productops.reconcile" }>;

/** A server-owned stage that nothing has touched for this long is stuck. */
export const STALL_AFTER_MS = 3 * 60_000;

/**
 * Finds runs the server owns that have gone quiet and asks for them to be
 * driven again.
 *
 * The queue is not the truth; the run row is. A job can be lost to a dead
 * letter or a worker killed past its grace period, and this is the belt to
 * the lock expiry's braces. Enqueueing is deduplicated per run, so a run with
 * a job already waiting is left alone.
 */
export const reconcileRuns: JobHandler<Reconcile> = async (_payload, context, run) => {
  const stalled = await context.runs.listStalledRuns({ quietForMs: STALL_AFTER_MS, limit: 20 });
  if (!stalled.ok) return { status: "retry", errorCode: "store_unavailable" };

  let enqueued = 0;
  for (const stuck of stalled.data) {
    const outcome = await context.jobs.enqueue({
      payload: {
        kind: "productops.drive",
        runId: stuck.id,
        review: null,
        correlationId: stuck.requestId ?? randomUUID(),
        source: "reconciler",
      },
    });
    if (outcome.ok && outcome.data.created) {
      enqueued += 1;
      run.logger.warn("worker.run_reconciled", { runId: stuck.id, stage: stuck.currentStage });
    }
  }

  return { status: "done", detail: { stalled: stalled.data.length, enqueued } };
};
