import { z } from "zod";

import type { LearnerVocabulary, VocabularyItem } from "@/domain/vocabulary";
import { reviewPriority } from "@/learning/vocabulary-engine";
import {
  fail,
  ok,
  repositoryError,
  type RepositoryResult,
} from "@/repositories/errors";
import type { VocabularyRepository } from "@/repositories/vocabulary-repository";

/**
 * Assembling a review session.
 *
 * The database picks what is due; the engine decides what to do first. Keeping
 * the ranking here rather than in SQL means it can be reasoned about and
 * changed without a migration, and the query stays one the composite index
 * can serve.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A session has to end. An unbounded list is a scrolling backlog rather than
 * something a learner can finish, and it is an unbounded query besides.
 */
export const DEFAULT_SESSION_SIZE = 20;
export const MAX_SESSION_SIZE = 50;

const requestSchema = z.strictObject({
  learnerId: z.uuid(),
  now: z.date(),
  limit: z.number().int().min(1).max(MAX_SESSION_SIZE).default(DEFAULT_SESSION_SIZE),
});

export type DueVocabularyRequest = z.input<typeof requestSchema>;

export interface DueVocabulary {
  readonly item: VocabularyItem;
  readonly progress: LearnerVocabulary;
  /** Whole days past the scheduled review. Zero for a word never scheduled. */
  readonly overdueDays: number;
}

function overdueDays(progress: LearnerVocabulary, now: Date): number {
  if (progress.nextReviewAt === null) return 0;

  return Math.max(
    0,
    Math.floor((now.getTime() - progress.nextReviewAt.getTime()) / DAY_MS),
  );
}

/**
 * The words this learner should practise now, most urgent first.
 *
 * A progress row whose word cannot be loaded fails the whole read. Dropping it
 * would hand back a short session that looks complete and hide the drift
 * between the two tables that caused it.
 */
export async function getDueVocabulary(
  repository: VocabularyRepository,
  request: DueVocabularyRequest,
): Promise<RepositoryResult<DueVocabulary[]>> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return fail(repositoryError("invalid_input", parsed.error));

  const { learnerId, now, limit } = parsed.data;

  const due = await repository.listDue(learnerId, now, limit);
  if (!due.ok) return due;
  if (due.data.length === 0) return ok([]);

  const items = await repository.findByIds(
    due.data.map((progress) => progress.vocabularyItemId),
  );
  if (!items.ok) return items;

  const byId = new Map(items.data.map((item) => [item.id, item]));

  const session: DueVocabulary[] = [];
  for (const progress of due.data) {
    const item = byId.get(progress.vocabularyItemId);
    if (!item) return fail(repositoryError("invalid_data"));

    session.push({ item, progress, overdueDays: overdueDays(progress, now) });
  }

  return ok(
    session.sort(
      (left, right) =>
        reviewPriority(right.progress, now) - reviewPriority(left.progress, now),
    ),
  );
}
