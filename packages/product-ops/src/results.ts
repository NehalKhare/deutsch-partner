import type {
  EventStatus,
  ProductOpsStage,
  StageOutcome,
} from "@dp/domain/product-ops";
import type { Logger } from "@dp/observability/logger";

import type { ProductOpsRepository } from "./repository";

/**
 * What one invocation of the workflow reports, and the helpers every caller
 * that moves a run needs. Kept apart from the workflow so a surface that only
 * records decisions — the operator's review actions — can import them without
 * also importing the agents, the gateway and the model ladder.
 */

export type AdvanceStatus =
  /** The stage ran and the run moved on. */
  | "advanced"
  /** A human gate. Only an operator's decision leaves it. */
  | "waiting"
  /** Work this process is not equipped to do. The worker's, not a failure. */
  | "deferred"
  /** Terminal. There is nothing left to advance. */
  | "finished"
  /** The stage failed and the run is now failed. */
  | "failed"
  /** Somebody else moved the run first. An ordinary outcome for a worker. */
  | "raced"
  /** The store could not be read or written. Nothing was decided. */
  | "unavailable";

export interface AdvanceResult {
  readonly status: AdvanceStatus;
  /** Where the run stands after this call. Null when it could not be read. */
  readonly stage: ProductOpsStage | null;
  /** What the stage reported, or null when nothing ran. */
  readonly outcome: StageOutcome | null;
  readonly costEur: number;
  /** A code, never a message. */
  readonly detail: string | null;
}

/**
 * The status the timeline records for entering a stage.
 *
 * Entry events and work events share the table and must not be confusable: a
 * work event says "this stage ran and here is its outcome", and an entry event
 * says "the run is now here". Without the distinction, the transition into
 * verification would look exactly like a verification that had passed, and the
 * idempotency guard would skip the check.
 */
export function entryStatus(stage: ProductOpsStage): EventStatus {
  if (stage === "failed") return "failed";
  if (stage === "rejected") return "rejected";

  return "started";
}

export async function moveProposal(
  deps: { readonly runs: ProductOpsRepository },
  proposalId: string,
  status: Parameters<ProductOpsRepository["setProposalStatus"]>[1],
  logger: Logger,
): Promise<void> {
  const outcome = await deps.runs.setProposalStatus(proposalId, status);
  if (outcome.ok) return;

  logger.warn("productops.status_not_set", {
    proposalId,
    status,
    errorKind: outcome.error.kind,
  });
}

export const nothingRan = (
  status: AdvanceStatus,
  stage: ProductOpsStage | null,
): AdvanceResult => ({ status, stage, outcome: null, costEur: 0, detail: null });
