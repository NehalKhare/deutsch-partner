import { z } from "zod";

import {
  learnerFeedbackSummarySchema,
  type LearnerFeedbackSummary,
} from "@dp/domain/trainer-coaching";
import { decodeInput, decodeRow } from "./result";
import type { RepositoryResult } from "./errors";
import type { DatabaseClient } from "./types";

/**
 * The operator's view of learner feedback.
 *
 * Read the way the cost dashboard and the product-ops board are read: one
 * database function, one jsonb document, validated on the way out. The client
 * is the operator's — the function's execute right is revoked from
 * authenticated, and the table beneath it shows a learner only their own
 * rows — so this is reachable from an operator page and the research stage,
 * and from nowhere a learner's session can see.
 */

/** How far back the board and the research stage look. A month, not a quarter. */
export const FEEDBACK_WINDOW_DAYS = 30;

/** How many notes the board shows. Enough to read, not a feed. */
export const FEEDBACK_NOTES_SHOWN = 20;

export interface LearnerFeedbackRepository {
  summary(input: {
    readonly days: number;
    readonly notes?: number;
  }): Promise<RepositoryResult<LearnerFeedbackSummary>>;
}

export function createLearnerFeedbackRepository(
  client: DatabaseClient,
): LearnerFeedbackRepository {
  return {
    async summary(input) {
      const parsed = decodeInput(
        input,
        z.object({
          days: z.number().int().min(1).max(365),
          notes: z.number().int().min(0).max(100).default(FEEDBACK_NOTES_SHOWN),
        }),
      );
      if (!parsed.ok) return parsed;

      const outcome = await client.rpc("learner_feedback_summary", {
        p_days: parsed.data.days,
        p_notes: parsed.data.notes,
      });

      return decodeRow(outcome, learnerFeedbackSummarySchema);
    },
  };
}

/** The share of votes that were unhelpful, 0 to 1, or null with nothing to divide. */
export function unhelpfulShare(totals: {
  readonly votes: number;
  readonly unhelpful: number;
}): number | null {
  return totals.votes === 0 ? null : totals.unhelpful / totals.votes;
}

/** "40%" — one figure an operator can read at a glance. */
export function percent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}
