import {
  failedStageOf,
  isRetryableStage,
  stageAfterReview,
  type ProductOpsStage,
  type ReviewAction,
  type ReviewOutcome,
} from "@dp/domain/product-ops";
import { ok, type RepositoryResult } from "@dp/db/errors";
import { nullLogger, type Logger } from "@dp/observability/logger";

import type { ProductOpsRepository } from "./repository";
import { entryStatus, moveProposal, nothingRan, type AdvanceResult } from "./results";

/**
 * The operator's two decisions: a review at a human gate, and a retry of a
 * failed run.
 *
 * Both record a transition and nothing more; driving the run afterwards is
 * the worker's. That is why they need only the repository and a logger, and
 * why they live apart from the workflow: the surface that records decisions
 * holds no model key and composes no gateway.
 */
export interface ReviewDeps {
  readonly runs: ProductOpsRepository;
  readonly logger?: Logger;
}

/** The brief a scan runs with when the operator gives none. */
export const DEFAULT_BRIEF = "German learning for English speakers";

export interface ReviewRequest {
  readonly proposalId: string;
  readonly action: ReviewAction;
  readonly newPriority: number | null;
  readonly comment: string | null;
  readonly operatorIdHash: string;
}

export interface ReviewResult {
  readonly review: ReviewOutcome;
  readonly advance: AdvanceResult;
  /** The run the decision moved, so a caller can drive it on. */
  readonly runId: string;
}

/**
 * Records a human decision and moves the run it belongs to.
 *
 * Both, in one place, because they are one act: a proposal that is approved
 * and a run still sitting at its gate is the state an operator would call a
 * bug. The decision itself is atomic in the database — the review row, the
 * proposal's status and, for a plan approval, the plan's — and the transition
 * that follows is the same compare-and-set every worker uses.
 *
 * Nothing here decides whether the caller may do this. That is the action's
 * job and the route's before it, and the tables' privileges after.
 */
export async function applyReview(
  deps: ReviewDeps,
  request: ReviewRequest,
): Promise<RepositoryResult<ReviewResult>> {
  const logger = deps.logger ?? nullLogger;

  const proposal = await deps.runs.getProposal(request.proposalId);
  if (!proposal.ok) return proposal;

  const run = await deps.runs.getRun(proposal.data.runId);
  if (!run.ok) return run;

  const stage = run.data.currentStage;

  const recorded = await deps.runs.review(request);
  if (!recorded.ok) return recorded;

  // An operator action on a privileged surface, per guardrails S24.
  logger.info("productops.reviewed", {
    audit: true,
    action: request.action,
    proposalId: request.proposalId,
    runId: run.data.id,
    stage,
    userIdHash: request.operatorIdHash,
    status: recorded.data.status,
  });

  const to = stageAfterReview(stage, request.action);
  if (to === null) {
    // A comment and a reprioritisation are decisions worth recording that are
    // not decisions to proceed. The run stays at its gate.
    return ok({
      review: recorded.data,
      advance: nothingRan("waiting", stage),
      runId: run.data.id,
    });
  }

  const moved = await deps.runs.advanceStage({
    runId: run.data.id,
    from: stage,
    to,
    event: {
      status: entryStatus(to),
      from: stage,
      review: request.action,
      requestId: run.data.requestId,
    },
  });
  if (!moved.ok) return moved;

  // Accepting a plan ends the run, and the board reads the proposal's own
  // status: the database function records the decision as 'coding', which
  // was true when a worker followed, and 'completed' is what is true now.
  if (moved.data.advanced && to === "completed") {
    await moveProposal(deps, request.proposalId, "completed", logger);
  }

  return ok({
    review: recorded.data,
    advance: {
      status: moved.data.advanced ? "advanced" : "raced",
      stage: moved.data.stage,
      outcome: null,
      costEur: 0,
      detail: null,
    },
    runId: run.data.id,
  });
}

// ---------------------------------------------------------------------------
// Trying again
// ---------------------------------------------------------------------------

export interface RetryRequest {
  readonly runId: string;
  readonly operatorIdHash: string;
}

export type RetryOutcome =
  /** The run is back at the stage that failed. The caller drives it. */
  | { readonly status: "retried"; readonly stage: ProductOpsStage }
  /** Not failed, so nothing to retry. Where it actually stands. */
  | { readonly status: "not_failed"; readonly stage: ProductOpsStage }
  /** Failed, but the timeline names no stage a retry could return to. */
  | { readonly status: "no_stage" }
  /** Another process moved it first. Where it now stands. */
  | { readonly status: "raced"; readonly stage: ProductOpsStage }
  | { readonly status: "unavailable" };

/**
 * Moves a failed run back to the stage that failed.
 *
 * Nothing is redone that does not need redoing: every stage checks for its
 * own output first, so a retry of the PRD stage after an approval finds the
 * proposal, the findings and the approval where they were and does only the
 * PRD again. The run's euro ceiling is unchanged and its timeline is kept —
 * what the failed attempt cost still counts, and the failure is still there
 * to read. The move itself is the same compare-and-set as every other
 * transition, from 'failed', so two operators pressing at once move it once.
 *
 * This records the move and nothing more. Driving the run is the caller's,
 * after the response, exactly as an approval is.
 */
export async function retryRun(
  deps: ReviewDeps,
  request: RetryRequest,
): Promise<RetryOutcome> {
  const logger = deps.logger ?? nullLogger;

  const loaded = await deps.runs.getRun(request.runId);
  if (!loaded.ok) return { status: "unavailable" };
  const run = loaded.data;

  if (run.currentStage !== "failed") {
    return { status: "not_failed", stage: run.currentStage };
  }

  const events = await deps.runs.listEvents(run.id);
  if (!events.ok) return { status: "unavailable" };

  const stage = failedStageOf(events.data);
  if (stage === null || !isRetryableStage(stage)) return { status: "no_stage" };

  // An operator action on a privileged surface, per guardrails S24. The code
  // the run stopped with is the one thing worth keeping beside the decision.
  logger.info("productops.retry_requested", {
    audit: true,
    runId: run.id,
    userIdHash: request.operatorIdHash,
    stage,
    errorCode: run.errorCode,
  });

  const moved = await deps.runs.advanceStage({
    runId: run.id,
    from: "failed",
    to: stage,
    event: {
      status: entryStatus(stage),
      from: "failed",
      retry: true,
      requestId: run.requestId,
    },
  });
  if (!moved.ok) return { status: "unavailable" };
  if (!moved.data.advanced) return { status: "raced", stage: moved.data.stage };

  return { status: "retried", stage };
}
