import type { ErrorType } from "@/domain/learner-error";
import type { LearnerVocabulary, VocabularyItem } from "@/domain/vocabulary";
import { ERROR_TYPE_LABELS } from "@/learning/error-labels";
import { EXPOSURE_MASTERY_CEILING } from "@/learning/vocabulary-engine";

/**
 * What a learner should review, and what to do about it.
 *
 * Everything here is a pure function of what the database already knows. No
 * model is involved and none should be: which words are due is arithmetic on
 * a review date, which words are weak is a comparison against a threshold, and
 * asking a model to redo either would be slower, dearer and occasionally wrong.
 */

/** Below this a word is not yet reliable, however many times it has been seen. */
export const WEAK_MASTERY_THRESHOLD = 0.5;

/** Seen at least this often, and still weak: that is a word to work on. */
export const WEAK_MIN_EXPOSURES = 3;

/**
 * How long a word counts as just practised.
 *
 * A sitting, generously measured. The due list already respects the schedule,
 * but the weak list is a judgement about the word rather than about the clock,
 * and without this it would offer back a word the learner answered correctly
 * ten minutes ago — which is not practice, and reads as though the work did
 * not count. Shorter than the shortest review interval by design: a day later
 * the word is fair game again if it is still weak.
 */
export const JUST_PRACTISED_HOURS = 4;

/** A review session that never ends is a review session nobody finishes. */
export const MAX_REVIEW_ITEMS = 20;

export interface DueItem {
  readonly record: LearnerVocabulary;
  /** Whole days past the review date. Negative means not yet due. */
  readonly overdueDays: number;
}

/**
 * A word with no review date has never been scheduled, which is not the same
 * as being overdue. It is excluded rather than treated as infinitely late.
 */
export function daysOverdue(record: LearnerVocabulary, now: Date): number | null {
  if (record.nextReviewAt === null) return null;

  const due = new Date(record.nextReviewAt).getTime();
  return Math.floor((now.getTime() - due) / 86_400_000);
}

/**
 * Due items, most overdue first.
 *
 * Mastered words are excluded: the point of mastery is that it stops
 * consuming a learner's attention. Ties break on the item id so a session is
 * the same session if the page is refreshed.
 */
export function dueForReview(
  records: readonly LearnerVocabulary[],
  now: Date,
  limit = MAX_REVIEW_ITEMS,
): readonly DueItem[] {
  return records
    .filter((record) => record.status !== "mastered")
    .map((record) => ({ record, overdueDays: daysOverdue(record, now) }))
    .filter((item): item is DueItem => item.overdueDays !== null && item.overdueDays >= 0)
    .sort(
      (a, b) =>
        b.overdueDays - a.overdueDays ||
        a.record.vocabularyItemId.localeCompare(b.record.vocabularyItemId),
    )
    .slice(0, limit);
}

/**
 * Words the learner keeps meeting and keeps not knowing.
 *
 * Distinct from "due": a word can be due simply because time passed. A weak
 * word has been seen enough times that low mastery is a fact about the word
 * rather than about the schedule — which is why this list is allowed to offer
 * a word before its review date, and why it needs the clock for one thing
 * only: a word worked on in this sitting is left alone until the next one.
 */
export function weakVocabulary(
  records: readonly LearnerVocabulary[],
  now: Date,
  limit = MAX_REVIEW_ITEMS,
): readonly LearnerVocabulary[] {
  const justPractised = (record: LearnerVocabulary) =>
    record.lastSeenAt !== null &&
    now.getTime() - record.lastSeenAt.getTime() < JUST_PRACTISED_HOURS * 3_600_000;

  return records
    .filter(
      (record) =>
        // Mastered words are excluded here for the same reason they are
        // excluded from the due list: mastery is what stops a word taking a
        // learner's attention, and a mastered word that still scores low is a
        // bug in the engine rather than a word to drill.
        record.status !== "mastered" &&
        record.exposureCount >= WEAK_MIN_EXPOSURES &&
        record.masteryScore < WEAK_MASTERY_THRESHOLD &&
        // Answered a moment ago, in the session the learner is still in.
        !justPractised(record),
    )
    .sort(
      (a, b) =>
        a.masteryScore - b.masteryScore ||
        b.exposureCount - a.exposureCount ||
        a.vocabularyItemId.localeCompare(b.vocabularyItemId),
    )
    .slice(0, limit);
}

export const REVIEW_ACTIVITIES = [
  "recall",
  "recognise",
  "use_in_sentence",
  "correct_the_mistake",
] as const;

export type ReviewActivityKind = (typeof REVIEW_ACTIVITIES)[number];

export interface ReviewActivity {
  readonly kind: ReviewActivityKind;
  readonly subject: string;
  readonly prompt: string;
}

/**
 * What kind of practice a word needs, from how well it is known.
 *
 * A word seen once or twice cannot be recalled cold — asking for it produces
 * a blank, which teaches nothing and feels like failure. Recognition first,
 * then recall, then production. This is the same ladder the mastery score
 * already encodes, read the other way round.
 */
export function activityForWord(record: LearnerVocabulary): ReviewActivityKind {
  if (record.masteryScore <= EXPOSURE_MASTERY_CEILING) return "recognise";
  if (record.masteryScore < 0.7) return "recall";
  return "use_in_sentence";
}

export interface ReviewPlan {
  readonly due: readonly DueItem[];
  readonly weak: readonly LearnerVocabulary[];
  readonly recurringErrors: readonly { errorType: ErrorType; pattern: string }[];
  /**
   * The same work, kept apart by texture: the vocabulary (due first, then
   * weak) and the recurring mistakes. The Catch up page wants one list and
   * reads `activities`; the trainer composes its own mix and needs the pools
   * it is mixing — slicing them back out of the concatenation would mean
   * knowing which kinds count as which, twice.
   */
  readonly vocabularyActivities: readonly ReviewActivity[];
  readonly mistakeActivities: readonly ReviewActivity[];
  readonly activities: readonly ReviewActivity[];
}

export interface ReviewInputs {
  readonly vocabulary: readonly LearnerVocabulary[];
  /**
   * The words themselves. A progress row carries only the item's id, and an
   * id must never reach a learner: "Which of these means
   * 4e3b1123-…?" is what this page showed the first time real progress rows
   * existed. Every activity is built from the resolved word or not at all.
   */
  readonly items: readonly VocabularyItem[];
  readonly recurringErrors: readonly { errorType: ErrorType; pattern: string }[];
  readonly now: Date;
  readonly limit?: number;
}

/** What a session is made of, before any of it is worded. */
interface SessionParts {
  readonly limit: number;
  readonly due: readonly DueItem[];
  readonly weak: readonly LearnerVocabulary[];
  readonly mistakes: readonly { errorType: ErrorType; pattern: string }[];
}

/**
 * What goes into a sitting, in order.
 *
 * Overdue words come first because a review that is late is losing value by
 * the day, then persistently weak words, then the mistakes that keep coming
 * back. A word already covered as overdue is not offered again as weak: the
 * same word twice in one session is padding, not practice.
 *
 * Separated from the wording because two callers need the selection and only
 * one needs the words: the Catch up page builds the whole plan, and the nav
 * badge needs nothing but how many. Counting it a second way is how a badge
 * comes to say one over a page that says four.
 */
function sessionParts(inputs: {
  readonly vocabulary: readonly LearnerVocabulary[];
  readonly recurringErrors: readonly { errorType: ErrorType; pattern: string }[];
  readonly now: Date;
  readonly limit?: number;
}): SessionParts {
  const limit = inputs.limit ?? MAX_REVIEW_ITEMS;
  const due = dueForReview(inputs.vocabulary, inputs.now, limit);
  const covered = new Set(due.map((item) => item.record.vocabularyItemId));

  // One mistake per category per session. Two recorded spelling errors are
  // one weakness, and a session that lists "Spelling" twice reads as a
  // stutter — the second recorded instance waits for a later sitting.
  const seenTypes = new Set<ErrorType>();
  const mistakes = inputs.recurringErrors.filter((error) => {
    if (seenTypes.has(error.errorType)) return false;
    seenTypes.add(error.errorType);
    return true;
  });

  const weak = weakVocabulary(inputs.vocabulary, inputs.now, limit).filter(
    (record) => !covered.has(record.vocabularyItemId),
  );

  return { limit, due, weak, mistakes };
}

/**
 * How many things a sitting would hold.
 *
 * The same selection the plan is built from, counted without resolving a
 * single word — which is what lets the nav badge state it on every page for
 * two small reads rather than three, and guarantees it is the number the Catch
 * up page's own headline prints.
 *
 * It needs no vocabulary items, so it cannot know about the one case where the
 * plan would drop an entry: a progress row whose word was not fetched. The
 * foreign key makes that a query bug rather than a state, and the page fetches
 * items by exactly these ids.
 */
export function catchUpCount(inputs: {
  readonly vocabulary: readonly LearnerVocabulary[];
  readonly recurringErrors: readonly { errorType: ErrorType; pattern: string }[];
  readonly now: Date;
  readonly limit?: number;
}): number {
  const { limit, due, weak, mistakes } = sessionParts(inputs);

  return Math.min(limit, due.length + weak.length + mistakes.length);
}

/**
 * The session.
 *
 * The selection above, with every word resolved and phrased into something a
 * learner can be asked.
 */
export function buildReviewPlan(inputs: ReviewInputs): ReviewPlan {
  const { limit, due, weak, mistakes } = sessionParts(inputs);

  // The foreign key guarantees every progress row's item exists, so a miss
  // here means the caller fetched fewer items than records — a query bug. A
  // record without its word is dropped rather than rendered, because the one
  // thing worse than a short session is a session that asks about a UUID.
  const byId = new Map(inputs.items.map((item) => [item.id, item]));

  const activityFor = (record: LearnerVocabulary): ReviewActivity | null => {
    const item = byId.get(record.vocabularyItemId);
    if (!item) return null;

    const kind = activityForWord(record);
    return { kind, subject: item.word, prompt: promptFor(kind, item) };
  };

  const vocabularyActivities = [
    ...due.map((item) => activityFor(item.record)),
    ...weak.map(activityFor),
  ].filter((activity): activity is ReviewActivity => activity !== null);

  const mistakeActivities: ReviewActivity[] = mistakes.map((error) => ({
    kind: "correct_the_mistake" as const,
    // The label, not the type key: this subject is read aloud in the
    // trainer's agenda and printed on the review page, and "case_dative"
    // is a log line where "The dative case" is teaching.
    subject: ERROR_TYPE_LABELS[error.errorType],
    // The note the evaluator recorded about what keeps going wrong. It is
    // a description, not an exercise — the old text prefixed it with "Fix
    // the sentence:" and there was never a sentence, which the trainer
    // then read out verbatim to a learner with nothing to fix.
    prompt: error.pattern,
  }));

  const activities = [...vocabularyActivities, ...mistakeActivities].slice(
    0,
    limit,
  );

  return {
    due,
    weak,
    recurringErrors: inputs.recurringErrors,
    vocabularyActivities,
    mistakeActivities,
    activities,
  };
}

/**
 * The question, phrased from the whole word.
 *
 * Each activity needs a different half of the pair: recognition shows the
 * German and asks for the meaning, recall shows the English and asks for the
 * German, production hands over the German and asks for a sentence. The old
 * text asked "which of these" while offering no choices, and asked for "the
 * German for" a word that was already German.
 */
function promptFor(kind: ReviewActivityKind, item: VocabularyItem): string {
  switch (kind) {
    case "recognise":
      return `What does "${item.word}" mean?`;
    case "recall":
      return `What is the German for "${item.englishTranslation}"?`;
    case "use_in_sentence":
      return `Use "${item.word}" in a sentence about your day.`;
    case "correct_the_mistake":
      // Unreachable for a vocabulary item — mistakes are built from recorded
      // errors above — but the switch must be total.
      return item.word;
  }
}
