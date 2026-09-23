"use server";

import { randomUUID } from "node:crypto";

import { refresh } from "next/cache";
import { z } from "zod";

import { reviewActionSchema, runBriefSchema, type ReviewAction } from "@dp/domain/product-ops";
import type { Logger } from "@dp/observability/logger";
import { DEFAULT_BRIEF, applyReview, retryRun } from "@dp/product-ops/review";
import { createProductOpsReader, type ProductOpsReader } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { operatorForAction } from "@/lib/auth/require-operator";

/**
 * The operator's six buttons.
 *
 * Every one of them re-checks the operator allowlist and returns silently on
 * failure. That is not belt and braces over the page's check: an action is its
 * own entry point, reachable by anyone who can post to this deployment, and it
 * has never rendered the page whose check it would be inheriting.
 *
 * Silently, and without saying whether there was anything to refuse. A
 * distinguishable refusal is a way to enumerate who is an operator.
 *
 * Each one is an audit event (guardrails S24 names admin activity explicitly),
 * and each records the operator's pseudonym rather than their id — the same
 * pseudonym the usage ledger carries, so this history survives an account
 * deletion without ever having been able to identify anybody.
 */

/** Both gates, in the order they fail. Null means do nothing, and say nothing. */
async function admitOperator(route: string): Promise<string | null> {
  // The allowlist, the second factor and the pseudonym, all checked again
  // here: an action has never rendered the page whose check it would inherit.
  const operator = await operatorForAction(route);
  if (operator === null) return null;

  // The tightest quota in the product. One press is a web-searching call per
  // query and then a reasoning-tier proposal.
  const decision = await limiterFor("product_ops").check(operator.hash);
  return decision.allowed ? operator.hash : null;
}

const briefSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? DEFAULT_BRIEF : value))
  .pipe(runBriefSchema);

const reviewSchema = z.object({
  proposalId: z.uuid(),
  action: reviewActionSchema,
  // Empty rather than absent, because that is what an untouched input posts,
  // and a blank priority field is "leave it alone" rather than zero.
  priority: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === "" ? null : Number(value),
    )
    .pipe(z.number().int().min(0).max(100).nullable()),
  comment: z
    .string()
    .max(2000)
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? null : value)),
});

/**
 * Asks the worker to drive a run.
 *
 * Nothing here runs a stage: this process holds no model key. It records a
 * job, deduplicated per run so a second press while the first is waiting is
 * a no-op, and a 'queued' event on the run's timeline so the board reads the
 * run as still working and an incident on a stuck worker has "queued at T"
 * to compare against the worker's first "started". The run's own request id
 * is the correlation id, so the ops app's log line, the job and every event
 * the worker writes read as one story.
 */
async function enqueueDrive(
  reader: ProductOpsReader,
  input: { runId: string; requestId: string | null; stage: string; review: ReviewAction | null; operator: string },
  logger: Logger,
): Promise<void> {
  const correlationId = input.requestId ?? randomUUID();
  const enqueued = await reader.jobs.enqueue({
    payload: {
      kind: "productops.drive",
      runId: input.runId,
      review: input.review,
      correlationId,
      source: "ops",
    },
    requestedByHash: input.operator,
  });

  if (!enqueued.ok) {
    logger.error("productops.enqueue_failed", {
      runId: input.runId,
      errorKind: enqueued.error.kind,
    });
    return;
  }

  logger.info("productops.enqueued", {
    audit: true,
    runId: input.runId,
    jobId: enqueued.data.id,
    created: enqueued.data.created,
    correlationId,
    userIdHash: input.operator,
  });

  if (!enqueued.data.created) return;

  await reader.runs.recordEvent({
    runId: input.runId,
    stage: input.stage,
    status: "queued",
    detail: { jobId: enqueued.data.id, correlationId },
  } as Parameters<ProductOpsReader["runs"]["recordEvent"]>[0]);
  await reader.runs.touchRun(input.runId);
}

/**
 * Starts a market scan.
 *
 * The run is created and then handed to the worker, one recorded stage at a
 * time, because a research pass is several model calls and a page should not
 * be holding a request open for them. The board shows where the run got to;
 * every step of it is a resume point, so a scan that dies halfway is one the
 * next press picks up rather than one that has to start again.
 */
export async function startScanAction(formData: FormData): Promise<void> {
  const operator = await admitOperator("/product/scan");
  if (operator === null) return;

  const brief = briefSchema.safeParse(formData.get("brief") ?? "");
  if (!brief.success) return;

  const reader = createProductOpsReader();
  const { runs, logger } = reader;

  const started = await runs.startRun({
    runType: "manual_market_scan",
    operatorIdHash: operator,
    requestId: randomUUID(),
    brief: brief.data,
  });

  if (!started.ok) {
    logger.error("productops.run_not_started", { errorKind: started.error.kind });
    refresh();
    return;
  }

  logger.info("productops.run_started", {
    audit: true,
    runId: started.data.id,
    userIdHash: operator,
    runType: started.data.runType,
  });

  await enqueueDrive(
    reader,
    {
      runId: started.data.id,
      requestId: started.data.requestId,
      stage: started.data.currentStage,
      review: null,
      operator,
    },
    logger,
  );

  refresh();
}

/**
 * Nudges one run on by one stage.
 *
 * The manual counterpart of the scan's background drive, for a run that
 * stopped where nothing was watching — a provider outage, a deployment
 * restart, a stage that raced and lost. It is safe to press twice: every stage
 * checks for its own output first.
 */
export async function advanceRunAction(formData: FormData): Promise<void> {
  const operator = await admitOperator("/product/advance");
  if (operator === null) return;

  const runId = z.uuid().safeParse(formData.get("runId"));
  if (!runId.success) return;

  const reader = createProductOpsReader();
  const { runs, logger } = reader;

  const run = await runs.getRun(runId.data);
  if (!run.ok) return;

  logger.info("productops.advance_requested", {
    audit: true,
    runId: runId.data,
    userIdHash: operator,
  });

  await enqueueDrive(
    reader,
    {
      runId: run.data.id,
      requestId: run.data.requestId,
      stage: run.data.currentStage,
      review: null,
      operator,
    },
    logger,
  );

  refresh();
}

/**
 * Tries a failed run again from the stage that failed.
 *
 * The counterpart of the nudge for a run that did not stall but stopped: a
 * provider that timed out on every rung, an answer that would not fit, a
 * budget that ran out. The run goes back to the stage its timeline says
 * failed and is driven from there in the background, under the same euro
 * ceiling and with its history intact. Every stage finds its own earlier
 * output, so an approval is not asked for twice and a proposal is not
 * written twice.
 */
export async function retryRunAction(formData: FormData): Promise<void> {
  const operator = await admitOperator("/product/retry");
  if (operator === null) return;

  const runId = z.uuid().safeParse(formData.get("runId"));
  if (!runId.success) return;

  const reader = createProductOpsReader();
  const { runs, logger } = reader;

  const outcome = await retryRun({ runs, logger }, { runId: runId.data, operatorIdHash: operator });

  if (outcome.status !== "retried") {
    logger.info("productops.retry_refused", {
      runId: runId.data,
      reason: outcome.status,
    });
    refresh();
    return;
  }

  const run = await runs.getRun(runId.data);
  await enqueueDrive(
    reader,
    {
      runId: runId.data,
      requestId: run.ok ? run.data.requestId : null,
      stage: outcome.stage,
      review: null,
      operator,
    },
    logger,
  );

  refresh();
}

/**
 * Removes a run that stopped without leaving anything behind.
 *
 * Failed and rejected runs only, and only when no proposal hangs off them: a
 * proposal is a decision's subject and its reviews are the audit trail, so a
 * run that produced one stays on the board however it ended. The status filter
 * is repeated in the database query, so a stale button on a run that has
 * since moved deletes nothing.
 */
export async function removeRunAction(formData: FormData): Promise<void> {
  const operator = await admitOperator("/product/remove");
  if (operator === null) return;

  const runId = z.uuid().safeParse(formData.get("runId"));
  if (!runId.success) return;

  const { runs, logger } = createProductOpsReader();

  const run = await runs.getRun(runId.data);
  if (!run.ok) return;
  if (run.data.status !== "failed" && run.data.status !== "rejected") return;

  const proposal = await runs.findProposalForRun(runId.data);
  if (!proposal.ok || proposal.data !== null) return;

  const removed = await runs.deleteRun(runId.data);
  if (!removed.ok) {
    logger.warn("productops.run_not_removed", {
      runId: runId.data,
      errorKind: removed.error.kind,
    });
    refresh();
    return;
  }

  logger.info("productops.run_removed", {
    audit: true,
    runId: runId.data,
    userIdHash: operator,
    stage: run.data.currentStage,
    errorCode: run.data.errorCode,
  });

  refresh();
}

/**
 * Records a decision about a proposal, and moves its run if the decision says
 * to.
 *
 * Approving is the one gate that hands work back to a worker, so an approval
 * enqueues the run afterwards; a plan approval ends the run, per the spec's
 * decision that the plan is the deliverable.
 */
export async function reviewProposalAction(formData: FormData): Promise<void> {
  const operator = await admitOperator("/product/review");
  if (operator === null) return;

  const request = reviewSchema.safeParse({
    proposalId: formData.get("proposalId"),
    action: formData.get("action"),
    priority: formData.get("priority") ?? undefined,
    comment: formData.get("comment") ?? undefined,
  });
  if (!request.success) return;

  const reader = createProductOpsReader();
  const { runs, logger } = reader;

  const outcome = await applyReview({ runs, logger }, {
    proposalId: request.data.proposalId,
    action: request.data.action,
    newPriority: request.data.priority,
    comment: request.data.comment,
    operatorIdHash: operator,
  });

  if (!outcome.ok) {
    logger.warn("productops.review_refused", {
      proposalId: request.data.proposalId,
      action: request.data.action,
      errorKind: outcome.error.kind,
    });
    refresh();
    return;
  }

  // Only a decision that moved the run has anything to drive. The graph is
  // parked at the gate this decision was for; the worker resumes it with the
  // decision, so the gate node adopts the transition applyReview just made
  // and carries on — an approval runs the PRD stage, a plan approval routes
  // to the coding worker's stages. A comment or a reprioritisation leaves the
  // run parked, and the graph parked with it.
  if (outcome.data.advance.status === "advanced") {
    const run = await runs.getRun(outcome.data.runId);
    await enqueueDrive(
      reader,
      {
        runId: outcome.data.runId,
        requestId: run.ok ? run.data.requestId : null,
        stage: outcome.data.advance.stage ?? "prd",
        review: request.data.action,
        operator,
      },
      logger,
    );
  }

  refresh();
}
