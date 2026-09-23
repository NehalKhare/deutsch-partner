import {
  learnerVocabularySchema,
  type LearnerVocabulary,
  type VocabularyItem,
} from "@dp/domain/vocabulary";
import { ok, type RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import {
  learnerVocabularyFromRow,
  learnerVocabularyToRow,
  vocabularyItemFromRow,
} from "./rows";
import type { DatabaseClient } from "./types";

const ITEMS = "vocabulary_items";
const PROGRESS = "learner_vocabulary";

export interface VocabularyRepository {
  findByLemmas(lemmas: readonly string[]): Promise<RepositoryResult<VocabularyItem[]>>;
  findByIds(ids: readonly string[]): Promise<RepositoryResult<VocabularyItem[]>>;
  listForLearner(
    learnerId: string,
    limit: number,
  ): Promise<RepositoryResult<LearnerVocabulary[]>>;
  /** The learner's progress on exactly these items, for read-modify-write. */
  listByItems(
    learnerId: string,
    vocabularyItemIds: readonly string[],
  ): Promise<RepositoryResult<LearnerVocabulary[]>>;
  listDue(
    learnerId: string,
    now: Date,
    limit: number,
  ): Promise<RepositoryResult<LearnerVocabulary[]>>;
  upsertLearnerVocabulary(
    record: LearnerVocabulary,
  ): Promise<RepositoryResult<LearnerVocabulary>>;
}

export function createVocabularyRepository(
  client: DatabaseClient,
): VocabularyRepository {
  return {
    async findByLemmas(lemmas) {
      // An empty IN list is a query that can only return nothing.
      if (lemmas.length === 0) return ok([]);

      const outcome = await client
        .from(ITEMS)
        .select("*")
        .in("lemma", lemmas);

      return decodeRows(outcome, vocabularyItemFromRow);
    },

    async findByIds(ids) {
      if (ids.length === 0) return ok([]);

      const outcome = await client.from(ITEMS).select("*").in("id", ids);

      return decodeRows(outcome, vocabularyItemFromRow);
    },

    async listForLearner(learnerId, limit) {
      const outcome = await client
        .from(PROGRESS)
        .select("*")
        .eq("learner_id", learnerId)
        .limit(limit);

      return decodeRows(outcome, learnerVocabularyFromRow);
    },

    async listByItems(learnerId, vocabularyItemIds) {
      if (vocabularyItemIds.length === 0) return ok([]);

      const outcome = await client
        .from(PROGRESS)
        .select("*")
        .eq("learner_id", learnerId)
        .in("vocabulary_item_id", vocabularyItemIds);

      return decodeRows(outcome, learnerVocabularyFromRow);
    },

    async listDue(learnerId, now, limit) {
      const outcome = await client
        .from(PROGRESS)
        .select("*")
        .eq("learner_id", learnerId)
        .lte("next_review_at", now.toISOString())
        .neq("status", "mastered")
        .order("next_review_at", { ascending: true })
        .limit(limit);

      return decodeRows(outcome, learnerVocabularyFromRow);
    },

    async upsertLearnerVocabulary(record) {
      const input = decodeInput(record, learnerVocabularySchema);
      if (!input.ok) return input;

      const outcome = await client
        .from(PROGRESS)
        .upsert(learnerVocabularyToRow(input.data))
        .select("*")
        .single();

      return decodeRow(outcome, learnerVocabularyFromRow);
    },
  };
}
