import {
  type LearnerVocabulary,
  type VocabularyStatus,
} from "@dp/domain/vocabulary";

/**
 * The vocabulary engine.
 *
 * One idea shapes all of it: exposure is not mastery. A learner can meet a
 * word a hundred times and still not be able to produce it, so encountering a
 * word moves a record only a little and can never carry it far, while
 * producing it correctly — especially after a gap — moves it a great deal.
 *
 * Every function is pure and returns a new record. Nothing here touches the
 * clock: the caller passes the moment, so behaviour across days is testable
 * without waiting for any.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far passive exposure alone can ever carry a record. */
export const EXPOSURE_MASTERY_CEILING = 0.25;
const EXPOSURE_GAIN = 0.03;

/** The score a status may not claim competence below. Matches the database. */
export const FAMILIAR_MASTERY = 0.6;
export const MASTERED_MASTERY = 0.85;
/** Correct uses required before a word is called mastered, however high the score. */
const MASTERED_CORRECT_USES = 3;

/** Share of the remaining distance to 1 that a correct recall closes. */
const CORRECT_GAIN = 0.25;
/** The gap at which a recall counts for the most; longer adds nothing further. */
const MATURE_INTERVAL_DAYS = 21;
/** What survives a lapse. Forgetting costs more than one recall earns back. */
const LAPSE_RETENTION = 0.5;

const CONFIDENCE_GAIN = 0.3;
const CONFIDENCE_LOSS = 0.25;

/** A word missed comes back tomorrow, whatever its history says. */
export const LAPSE_INTERVAL_DAYS = 1;

/**
 * Days until the next review, by mastery. A ladder rather than a formula: the
 * steps are what a learner experiences, so they are worth reading directly.
 */
const REVIEW_LADDER: ReadonlyArray<{ upTo: number; days: number }> = [
  { upTo: 0.2, days: 1 },
  { upTo: 0.4, days: 2 },
  { upTo: 0.6, days: 4 },
  { upTo: 0.8, days: 9 },
  { upTo: 0.95, days: 21 },
  { upTo: Infinity, days: 45 },
];

export type VocabularyOutcome = "exposure" | "correct" | "incorrect";

/** mastery_score and confidence are numeric(4,3); keep memory and column equal. */
function toStoredPrecision(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** A gap the clock reports as negative is a clock problem, not evidence. */
function elapsedDays(elapsedMs: number | null): number {
  return elapsedMs === null ? 0 : Math.max(0, elapsedMs) / DAY_MS;
}

export interface MasteryInput {
  readonly masteryScore: number;
  readonly outcome: VocabularyOutcome;
  /** Since the word was last seen. Null the first time. */
  readonly elapsedMs: number | null;
}

/**
 * The score after one event.
 *
 * A correct recall closes a share of the distance to 1, so progress slows as
 * the learner approaches certainty, and the share doubles across a three-week
 * gap: remembering a word after a long silence is the strongest evidence
 * available that it has actually been learned.
 */
export function calculateMastery(input: MasteryInput): number {
  const current = Math.min(1, Math.max(0, input.masteryScore));

  if (input.outcome === "incorrect") {
    return toStoredPrecision(current * LAPSE_RETENTION);
  }

  if (input.outcome === "exposure") {
    return toStoredPrecision(
      Math.min(EXPOSURE_MASTERY_CEILING, current + EXPOSURE_GAIN),
    );
  }

  const spacing = 1 + Math.min(elapsedDays(input.elapsedMs) / MATURE_INTERVAL_DAYS, 1);

  return toStoredPrecision(current + (1 - current) * CORRECT_GAIN * spacing);
}

export interface ConfidenceInput {
  readonly confidence: number;
  readonly outcome: VocabularyOutcome;
}

/**
 * How sure we are the learner can produce the word unprompted.
 *
 * Seeing a word leaves this untouched. Losses are a flat step rather than a
 * share, so repeated failure reaches zero instead of asymptotically hovering
 * above it and quietly keeping a broken word out of review.
 */
export function calculateConfidence(input: ConfidenceInput): number {
  const current = Math.min(1, Math.max(0, input.confidence));

  if (input.outcome === "exposure") return toStoredPrecision(current);
  if (input.outcome === "incorrect") {
    return toStoredPrecision(current - CONFIDENCE_LOSS);
  }

  return toStoredPrecision(current + (1 - current) * CONFIDENCE_GAIN);
}

export interface StatusInput {
  readonly exposureCount: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly masteryScore: number;
}

/**
 * The status is derived, never set.
 *
 * The database refuses a record whose status claims more than its score
 * supports. Deriving both from the same evidence means the two cannot drift
 * into disagreeing, so that constraint can never be the thing that fails.
 */
export function deriveVocabularyStatus(input: StatusInput): VocabularyStatus {
  if (input.exposureCount === 0) return "new";

  if (
    input.masteryScore >= MASTERED_MASTERY &&
    input.correctCount >= MASTERED_CORRECT_USES
  ) {
    return "mastered";
  }

  if (input.masteryScore >= FAMILIAR_MASTERY) return "familiar";

  // More misses than hits, with enough attempts for that to mean something.
  if (
    input.incorrectCount > input.correctCount &&
    input.incorrectCount + input.correctCount >= 3
  ) {
    return "weak";
  }

  return input.correctCount + input.incorrectCount > 0 ? "learning" : "introduced";
}

export interface ReviewSchedulingInput {
  readonly masteryScore: number;
  readonly lapsed: boolean;
}

export function scheduleReview(
  input: ReviewSchedulingInput,
  from: Date,
): Date {
  const days = input.lapsed
    ? LAPSE_INTERVAL_DAYS
    : (REVIEW_LADDER.find((step) => input.masteryScore < step.upTo)?.days ??
      LAPSE_INTERVAL_DAYS);

  return new Date(from.getTime() + days * DAY_MS);
}

export function newLearnerVocabulary(
  learnerId: string,
  vocabularyItemId: string,
): LearnerVocabulary {
  return {
    learnerId,
    vocabularyItemId,
    exposureCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    masteryScore: 0,
    confidence: 0,
    lastSeenAt: null,
    nextReviewAt: null,
    status: "new",
  };
}

function applyEvent(
  record: LearnerVocabulary,
  outcome: VocabularyOutcome,
  at: Date,
): LearnerVocabulary {
  const elapsedMs =
    record.lastSeenAt === null ? null : at.getTime() - record.lastSeenAt.getTime();

  const masteryScore = calculateMastery({
    masteryScore: record.masteryScore,
    outcome,
    elapsedMs,
  });
  const confidence = calculateConfidence({
    confidence: record.confidence,
    outcome,
  });

  // A use is also an encounter, so recorded uses can never exceed exposures —
  // the invariant the database checks holds by construction rather than by
  // the caller remembering to record both.
  const counts = {
    exposureCount: record.exposureCount + 1,
    correctCount: record.correctCount + (outcome === "correct" ? 1 : 0),
    incorrectCount: record.incorrectCount + (outcome === "incorrect" ? 1 : 0),
  };

  return {
    ...record,
    ...counts,
    masteryScore,
    confidence,
    lastSeenAt: at,
    nextReviewAt: scheduleReview(
      { masteryScore, lapsed: outcome === "incorrect" },
      at,
    ),
    status: deriveVocabularyStatus({ ...counts, masteryScore }),
  };
}

/** The learner met the word — it appeared in a reply, a text, a prompt. */
export function recordExposure(
  record: LearnerVocabulary,
  at: Date,
): LearnerVocabulary {
  return applyEvent(record, "exposure", at);
}

/** The learner produced the word correctly, unprompted. */
export function recordCorrectUse(
  record: LearnerVocabulary,
  at: Date,
): LearnerVocabulary {
  return applyEvent(record, "correct", at);
}

/** The learner reached for the word and got it wrong. */
export function recordIncorrectUse(
  record: LearnerVocabulary,
  at: Date,
): LearnerVocabulary {
  return applyEvent(record, "incorrect", at);
}

/**
 * What one evaluated turn says about each word.
 *
 * The evaluation's word lists are model output; this mapping is the
 * deterministic reading of them, and the only path by which they move a
 * learner's vocabulary record. Precedence is deliberate: evidence of trouble
 * beats evidence of use (a word can appear in both lists), and use beats a
 * bare mention.
 *
 * Bounded, because every entry becomes a database write on the turn's own
 * clock: a runaway list would make one message cost seventy upserts.
 */
export const MAX_VOCABULARY_WRITES_PER_TURN = 20;

export function vocabularyOutcomes(evaluation: {
  readonly vocabularyUsed: readonly string[];
  readonly vocabularyWeaknesses: readonly string[];
  readonly masterySignals: readonly {
    readonly lemma: string;
    readonly direction: "up" | "down";
  }[];
  readonly reviewCandidates: readonly string[];
}): ReadonlyMap<string, VocabularyOutcome> {
  const outcomes = new Map<string, VocabularyOutcome>();

  const set = (lemma: string, outcome: VocabularyOutcome) => {
    const trimmed = lemma.trim();
    if (trimmed.length === 0) return;
    const current = outcomes.get(trimmed);
    // incorrect > correct > exposure, whatever order the lists arrive in.
    const rank = { incorrect: 2, correct: 1, exposure: 0 } as const;
    if (current === undefined || rank[outcome] > rank[current]) {
      outcomes.set(trimmed, outcome);
    }
  };

  for (const lemma of evaluation.reviewCandidates) set(lemma, "exposure");
  for (const lemma of evaluation.vocabularyUsed) set(lemma, "correct");
  for (const signal of evaluation.masterySignals) {
    set(signal.lemma, signal.direction === "up" ? "correct" : "incorrect");
  }
  for (const lemma of evaluation.vocabularyWeaknesses) set(lemma, "incorrect");

  return new Map([...outcomes].slice(0, MAX_VOCABULARY_WRITES_PER_TURN));
}

/**
 * How badly a word needs attention now.
 *
 * Overdue days dominate, with the weaker word winning a tie. A word that has
 * never been scheduled counts as one day overdue rather than as not due at
 * all, so nothing introduced can quietly fall out of the rotation.
 */
export function reviewPriority(record: LearnerVocabulary, now: Date): number {
  const overdueDays =
    record.nextReviewAt === null
      ? 1
      : Math.max(0, (now.getTime() - record.nextReviewAt.getTime()) / DAY_MS);

  return overdueDays + (1 - record.masteryScore);
}
