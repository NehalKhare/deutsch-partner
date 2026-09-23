import type { ActivityType, RecommendationReason } from "@dp/domain/recommendation";

/**
 * Which activity to put in front of a learner next.
 *
 * A scoring function, not a prompt. The routing document is explicit about
 * this and gives the reason: deterministic ranking is cheaper, faster,
 * testable, reproducible and explainable to the learner, and all four matter
 * more here than nuance. A model asked to pick an activity would also have to
 * be given the learner's whole state to do it, which is the most expensive
 * prompt in the product for the least valuable output.
 *
 * The weights are the ones section 5 names, with the values chosen here and
 * held to account by tests rather than by assertion.
 */

export interface RankingInputs {
  /** Review items whose next review date has passed. */
  readonly overdueReviewItems: number;
  /** Recurring mistakes still unresolved. */
  readonly unresolvedErrors: number;
  /** 0 when the activity sits exactly at the learner's level. */
  readonly levelDistance: number;
  /** Whether the activity's topic is one the learner asked for. */
  readonly matchesInterest: boolean;
  /** Turns since this activity type was last recommended; null if never. */
  readonly turnsSinceRecommended: number | null;
  /** Whether this type is absent from the recent recommendation history. */
  readonly addsDiversity: boolean;
}

export interface Candidate {
  readonly activityType: ActivityType;
  readonly title: string;
  readonly reason: RecommendationReason;
  readonly inputs: RankingInputs;
}

export interface RankedCandidate {
  readonly candidate: Candidate;
  readonly score: number;
  readonly parts: Readonly<Record<keyof typeof WEIGHTS, number>>;
}

export const WEIGHTS = {
  reviewDue: 0.3,
  weakness: 0.25,
  levelFit: 0.2,
  interest: 0.1,
  recency: 0.1,
  diversity: 0.05,
} as const;

/** Past this many overdue items the signal is saturated: overdue is overdue. */
const REVIEW_SATURATION = 12;
const WEAKNESS_SATURATION = 5;

/** How far off-level an activity can be before it is no use at all. */
const LEVEL_SPAN = 8;

/** Recommending the same type again within this many turns is repetition. */
export const RECENCY_WINDOW = 6;

const saturate = (value: number, at: number) => Math.min(1, Math.max(0, value) / at);

export function scoreCandidate(candidate: Candidate): RankedCandidate {
  const inputs = candidate.inputs;

  const parts = {
    reviewDue: saturate(inputs.overdueReviewItems, REVIEW_SATURATION),
    weakness: saturate(inputs.unresolvedErrors, WEAKNESS_SATURATION),
    levelFit: Math.max(0, 1 - Math.abs(inputs.levelDistance) / LEVEL_SPAN),
    interest: inputs.matchesInterest ? 1 : 0,
    // A penalty expressed as a score, so every term points the same way: 1 is
    // "this has not been suggested lately", 0 is "this was the last thing".
    recency:
      inputs.turnsSinceRecommended === null
        ? 1
        : Math.min(1, inputs.turnsSinceRecommended / RECENCY_WINDOW),
    diversity: inputs.addsDiversity ? 1 : 0,
  };

  const score = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce(
    (total, key) => total + WEIGHTS[key] * parts[key],
    0,
  );

  return { candidate, score, parts };
}

/**
 * Ranks candidates, highest first.
 *
 * Ties break on the activity type's name so the same state produces the same
 * ordering twice. A recommendation that reshuffles on refresh looks arbitrary,
 * and a learner who cannot predict the product stops trusting it.
 */
export function rankCandidates(
  candidates: readonly Candidate[],
): readonly RankedCandidate[] {
  return candidates
    .map(scoreCandidate)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.activityType.localeCompare(b.candidate.activityType),
    );
}

/**
 * Whether the top two are close enough that the ordering is not meaningful.
 *
 * The routing table permits a cheap-tier tiebreak here and only here. It is
 * feature-flagged off, and this is the predicate that would gate it.
 */
export const TIEBREAK_EPSILON = 0.02;

export function isTie(ranked: readonly RankedCandidate[]): boolean {
  return ranked.length >= 2 && ranked[0].score - ranked[1].score < TIEBREAK_EPSILON;
}
