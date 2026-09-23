import type { LearnerVocabulary, VocabularyItem } from "@dp/domain/vocabulary";
import { WEAK_MASTERY_THRESHOLD, WEAK_MIN_EXPOSURES } from "@dp/learning/review";

/**
 * The words behind the four numbers on the dashboard.
 *
 * A tile saying "45 known" is a fact a learner cannot check and cannot use.
 * The same tile opened is a vocabulary list — which words, which article,
 * what they mean — and that is something to read.
 *
 * The predicates here mirror the ones the tiles are counted with, in the
 * learner_dashboard function (supabase/migrations, `vocab` CTE). They have to:
 * a list that disagrees with the number above it is worse than no list. The
 * two thresholds behind "tricky" are imported from the review engine rather
 * than written down again, because that is where the rule belongs and a second
 * copy is a second thing to forget.
 */

export const VOCABULARY_BUCKETS = ["known", "mastered", "due", "tricky"] as const;
export type VocabularyBucket = (typeof VOCABULARY_BUCKETS)[number];

/** What a learner reads: the word with its article, and what it means. */
export interface PractisedWord {
  readonly id: string;
  /** The bare word, article removed — it is shown separately and coloured. */
  readonly word: string;
  readonly article: "der" | "die" | "das" | null;
  readonly english: string;
  readonly masteryScore: number;
}

export type VocabularyWords = Readonly<
  Record<VocabularyBucket, readonly PractisedWord[]>
>;

const ARTICLE = /^(der|die|das)\s+/u;

/** German dictionaries file a noun under its noun, not under its article. */
function withoutArticle(word: string): string {
  return word.replace(ARTICLE, "");
}

function toWord(record: LearnerVocabulary, item: VocabularyItem): PractisedWord {
  return {
    id: item.id,
    word: withoutArticle(item.word),
    article: item.gender,
    english: item.englishTranslation,
    masteryScore: record.masteryScore,
  };
}

const alphabetical = (a: PractisedWord, b: PractisedWord) =>
  a.word.localeCompare(b.word, "de");

/**
 * Every practised word, sorted into the buckets the tiles count.
 *
 * A record whose word is not in the list of items is dropped rather than shown
 * as an id. The caller compares each list's length against the tile's own
 * count and says so when they differ, so a dropped word is visible as a
 * shortfall rather than as a silently shorter list.
 */
export function vocabularyWords(input: {
  readonly records: readonly LearnerVocabulary[];
  readonly items: readonly VocabularyItem[];
  readonly now: Date;
}): VocabularyWords {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const known: PractisedWord[] = [];
  const mastered: PractisedWord[] = [];
  const due: Array<{ word: PractisedWord; at: number }> = [];
  const tricky: Array<{ word: PractisedWord; record: LearnerVocabulary }> = [];

  for (const record of input.records) {
    const item = byId.get(record.vocabularyItemId);
    if (item === undefined) continue;

    const word = toWord(record, item);
    known.push(word);

    if (record.status === "mastered") mastered.push(word);

    // A word with no review date is not due, which is what `next_review_at <=
    // now` means in SQL — null compares to nothing.
    if (
      record.nextReviewAt !== null &&
      record.nextReviewAt.getTime() <= input.now.getTime() &&
      record.status !== "mastered"
    ) {
      due.push({ word, at: record.nextReviewAt.getTime() });
    }

    if (
      record.exposureCount >= WEAK_MIN_EXPOSURES &&
      record.masteryScore < WEAK_MASTERY_THRESHOLD
    ) {
      tricky.push({ word, record });
    }
  }

  return {
    known: known.sort(alphabetical),
    mastered: mastered.sort(alphabetical),
    // Most overdue first: the point of the list is what to do about it.
    due: due.sort((a, b) => a.at - b.at).map((entry) => entry.word),
    // Weakest first, and the more exposures behind the same score the worse.
    tricky: tricky
      .sort(
        (a, b) =>
          a.record.masteryScore - b.record.masteryScore ||
          b.record.exposureCount - a.record.exposureCount ||
          alphabetical(a.word, b.word),
      )
      .map((entry) => entry.word),
  };
}
