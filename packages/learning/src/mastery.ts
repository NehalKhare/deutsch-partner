/**
 * When performance at a level counts as mastery, and how close a tally is.
 *
 * The routing document names mastery score calculation and level advancement
 * gating as work that must never be a model call, so the gate is arithmetic:
 * the model's per-turn evaluation feeds the tally, and the tally decides.
 *
 * A leaf module on purpose: the chat page draws this arithmetic as a progress
 * bar, and pulling it from progression.ts would drag the whole authored
 * curriculum into the client bundle for three numbers.
 */

/** The per-level tally the mastery gate reads: two integers, nothing else. */
export interface LevelTally {
  readonly turns: number;
  readonly strongTurns: number;
}

/**
 * Four strong turns out of five is the default bar — a learner writing four
 * in five messages without an error is not being taught anything by staying.
 * The learner may lower it in settings (see MASTERY_THRESHOLDS in the domain);
 * every function here takes the ratio as a parameter and falls back to this.
 *
 * The minimum is not negotiable at any setting: it is what "confident" means
 * here — two good sentences are a mood, five evaluated turns are evidence.
 */
export const MASTERY_RATIO = 0.8;
export const MASTERY_MIN_TURNS = 5;

/** The learner's chosen pass mark, stored as a percentage, as the ratio the gate compares. */
export function thresholdRatio(percent: number): number {
  return percent / 100;
}

/**
 * Whether one evaluated turn counts towards mastery.
 *
 * A turn is strong when the evaluation found nothing to correct. Skill
 * estimates are deliberately not consulted: they are the model's opinion on a
 * continuous scale, and a threshold over an opinion is a model call with
 * extra steps. An empty error list is a fact.
 */
export function isStrongTurn(evaluation: {
  readonly errors: readonly unknown[];
}): boolean {
  return evaluation.errors.length === 0;
}

export function hasMastered(
  performance: LevelTally,
  ratio: number = MASTERY_RATIO,
): boolean {
  if (performance.turns < MASTERY_MIN_TURNS) return false;
  return performance.strongTurns / performance.turns >= ratio;
}

/**
 * How full the mastery bar is, as a fraction of the ratio the gate wants.
 *
 * The bar shows the strong-turn ratio against the target — the learner's own
 * pass mark — because that is the part of the gate a learner can feel turn by
 * turn: an error-free turn raises it, a turn with errors lowers it. The other
 * half of the gate — at least five evaluated turns — is shown separately as
 * evidence collected, because folding both into one number makes an early
 * error look like progress, which is not a story anybody should be told.
 *
 * No turns is an empty bar, not a full one: a ratio over nothing is nothing.
 */
export function masteryFill(
  tally: LevelTally | null,
  ratio: number = MASTERY_RATIO,
): number {
  if (!tally || tally.turns === 0) return 0;
  return Math.min(1, tally.strongTurns / tally.turns / ratio);
}

export type TurnQuality = "strong" | "weak";

/**
 * What the newest recorded turn was, read off the tally before and after.
 *
 * The server never says "that turn was weak" in so many words — it returns the
 * whole tally, which is the authoritative thing. The difference of one turn is
 * the only difference this will name; anything else (a reload, a level move, a
 * tally that jumped) is not a single turn and gets no verdict.
 */
export function turnQuality(
  before: LevelTally | null,
  after: LevelTally,
): TurnQuality | null {
  const turnsBefore = before?.turns ?? 0;
  const strongBefore = before?.strongTurns ?? 0;

  if (after.turns !== turnsBefore + 1) return null;
  return after.strongTurns === strongBefore + 1 ? "strong" : "weak";
}
