import { z } from "zod";

import {
  MAX_LEARNING_SIGNALS,
  learningSignals,
  type LearningSignal,
} from "@/learning/error-engine";
import {
  fail,
  ok,
  repositoryError,
  type RepositoryResult,
} from "@/repositories/errors";
import type { LearnerErrorRepository } from "@/repositories/learner-error-repository";

/**
 * Reading a learner's open mistakes and deciding which matter now.
 *
 * The database orders by how often a mistake happened, which is the wrong
 * order on its own: something done twenty times last spring should lose to
 * something done four times this week. So more rows are fetched than are
 * returned, and the engine re-ranks them by recency-discounted weight.
 */

/**
 * How many open patterns to consider. Wide enough that recency can genuinely
 * reorder the list, bounded so the query stays one the partial index serves.
 */
export const SIGNAL_CANDIDATE_POOL = 50;

const requestSchema = z.strictObject({
  learnerId: z.uuid(),
  now: z.date(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LEARNING_SIGNALS)
    .default(MAX_LEARNING_SIGNALS),
});

export type LearningSignalsRequest = z.input<typeof requestSchema>;

export async function getLearningSignals(
  repository: LearnerErrorRepository,
  request: LearningSignalsRequest,
): Promise<RepositoryResult<readonly LearningSignal[]>> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return fail(repositoryError("invalid_input", parsed.error));

  const { learnerId, now, limit } = parsed.data;

  const open = await repository.listUnresolved(learnerId, SIGNAL_CANDIDATE_POOL);
  if (!open.ok) return open;

  return ok(learningSignals(open.data, now, limit));
}
