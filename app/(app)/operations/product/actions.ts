"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { reviewActionSchema, runBriefSchema } from "@/domain/product-ops";
import { createProductOpsGraph, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";
import { driveRunGraph } from "@/lib/product-ops/graph/graph";
import { DEFAULT_BRIEF, applyReview } from "@/lib/product-ops/workflow";

/**
 * The operator's five buttons.
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

/**
 * The identity every write here is attributed to.
 *
 * Strict rather than best-effort: a privileged action recorded against nobody
 * is the one row this audit trail cannot afford, and the tables refuse an
 * empty operator hash anyway. Null when the salt is unset, and the caller
 * refuses rather than inventing an attribution.
 */
function operatorHash(learnerId: string): string | null {
  try {
    return pseudonymFor(learnerId);
  } catch {
    return null;
  }
}

/** Both gates, in the order they fail. Null means do nothing, and say nothing. */
async function admitOperator(): Promise<string | null> {
  const learnerId = await requireAuthenticatedUserId();
  if (!isOperator(learnerId)) return null;

  const hash = operatorHash(learnerId);
  if (hash === null) return null;

  // The tightest quota in the product. One press is a web-searching call per
  // query and then a reasoning-tier proposal.
  return limiterFor("product_ops").check(hash).allowed ? hash : null;
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
 * Starts a market scan.
 *
 * The run is created and then driven in the background, one recorded stage at
 * a time, because a research pass is several model calls and a page should not
 * be holding a request open for them. The board shows where the run got to;
 * every step of it is a resume point, so a scan that dies halfway is one the
 * next press picks up rather than one that has to start again.
 */
export async function startScanAction(formData: FormData): Promise<void> {
  const operator = await admitOperator();
  if (operator === null) return;

  const brief = briefSchema.safeParse(formData.get("brief") ?? "");
  if (!brief.success) return;

  const { runs, workflow, logger } = createProductOpsGraph();

  const started = await runs.startRun({
    runType: "manual_market_scan",
    operatorIdHash: operator,
    requestId: null,
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

  // After the response, so the operator is not waiting on the provider. The
  // callback form: the work does not begin until the page has gone out.
  after(async () => {
    await driveRunGraph(workflow, started.data.id);
  });

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
  const operator = await admitOperator();
  if (operator === null) return;

  const runId = z.uuid().safeParse(formData.get("runId"));
  if (!runId.success) return;

  const { workflow, logger } = createProductOpsGraph();

  logger.info("productops.advance_requested", {
    audit: true,
    runId: runId.data,
    userIdHash: operator,
  });

  after(async () => {
    await driveRunGraph(workflow, runId.data);
  });

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
  const operator = await admitOperator();
  if (operator === null) return;

  const runId = z.uuid().safeParse(formData.get("runId"));
  if (!runId.success) return;

  const { runs, logger } = createProductOpsGraph();

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
 * Approving is the one gate that hands work back to the server, so an approval
 * drives the run on afterwards; the plan approval hands it to the worker
 * instead, which is a command an operator runs and not something this can do.
 */
export async function reviewProposalAction(formData: FormData): Promise<void> {
  const operator = await admitOperator();
  if (operator === null) return;

  const request = reviewSchema.safeParse({
    proposalId: formData.get("proposalId"),
    action: formData.get("action"),
    priority: formData.get("priority") ?? undefined,
    comment: formData.get("comment") ?? undefined,
  });
  if (!request.success) return;

  const { workflow, logger } = createProductOpsGraph();

  const outcome = await applyReview(workflow, {
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
  // parked at the gate this decision was for; resuming it with the decision
  // lets the gate node adopt the transition applyReview just made and carry
  // on — an approval runs the PRD stage, a plan approval routes to the
  // worker's stages and stops there as deferred. A comment or a
  // reprioritisation leaves the run parked, and the graph parked with it.
  if (outcome.data.advance.status === "advanced") {
    const runId = outcome.data.runId;
    const action = request.data.action;
    after(async () => {
      await driveRunGraph(workflow, runId, action);
    });
  }

  refresh();
}
