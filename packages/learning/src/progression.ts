import {
  MAX_MINI_LEVEL,
  cefrForMiniLevel,
  miniLevelRangeFor,
  type CEFRLevel,
} from "@dp/domain/cefr";
import type { LearnerState } from "@dp/domain/learner";
import { getMiniLevel } from "./mini-levels";
import type { MiniLevelDefinition } from "@dp/domain/mini-level";

/**
 * Moving a learner along the path.
 *
 * Pure functions over learner state, and that is not a stylistic preference:
 * the routing document names mini-level progression and level advancement
 * gating as work that must never be a model call, and says outright that
 * implementing either as one is a bug. A learner's typed message is untrusted
 * input; it may ask for a move, and application code decides whether one
 * happens.
 *
 * Every function here returns a whole `LearnerState`, because the pieces
 * cannot move independently. The domain schema and a database CHECK both
 * refuse a state whose mini-level and effective level disagree about where
 * the learner is, so a change to one is a change to all of them or it is a
 * write that fails.
 */

export interface Moved {
  readonly state: LearnerState;
  readonly level: MiniLevelDefinition;
  /** What actually changed, for something that has to explain it. */
  readonly from: number;
  readonly to: number;
}

/**
 * The effective level a mini-level implies.
 *
 * Explicitly chosen or explicitly requested movement clears the estimate. The
 * estimate is evidence about a learner's writing, and evidence that predates
 * a deliberate move is evidence about somewhere they no longer are — it will
 * rebuild from their next few messages. Leaving it in place would also make
 * the state unwritable, since the effective level derives from the estimate
 * first and the refinement demands it match the new band.
 */
function placedAt(state: LearnerState, miniLevel: number): LearnerState {
  const cefr = cefrForMiniLevel(miniLevel);

  return {
    ...state,
    miniLevel,
    selectedLevel: cefr,
    estimatedLevel: null,
    effectiveLevel: { cefr, plus: false },
    furthestMiniLevel: Math.max(state.furthestMiniLevel, miniLevel),
  };
}

/**
 * Where a learner lands when they choose a level.
 *
 * Back where they left it, not at the front of it. Somebody on mini-level 30
 * who looks at A1 for five minutes has not given up twelve levels of
 * position, and a toggle that costs them that is a toggle they use once.
 *
 * A learner who has never reached the band starts at its first level; one who
 * has been past it returns to its last, which is the level they left it on.
 */
export function miniLevelForLevel(
  level: CEFRLevel,
  furthestMiniLevel: number,
): number {
  const { first, last } = miniLevelRangeFor(level);

  return Math.min(Math.max(furthestMiniLevel, first), last);
}

/** Whether choosing this level would actually move the learner. */
export function isAtLevel(state: LearnerState, level: CEFRLevel): boolean {
  return state.effectiveLevel.cefr === level;
}

/**
 * Puts the learner at a level they asked for.
 *
 * Returns null when they are already there, so a caller can tell a no-op from
 * a move and not write a row or announce a change that did not happen.
 */
export function switchToLevel(
  state: LearnerState,
  level: CEFRLevel,
): Moved | null {
  if (isAtLevel(state, level)) return null;

  const to = miniLevelForLevel(level, state.furthestMiniLevel);

  return {
    state: placedAt(state, to),
    level: getMiniLevel(to),
    from: state.miniLevel,
    to,
  };
}

/**
 * Puts the learner at an exact mini-level they picked off the syllabus.
 *
 * The curriculum page shows all seventy levels, and a learner may stand
 * wherever they like: this is their syllabus, not a locked ladder. Like the
 * band toggle it marks nothing as skipped — walking to a shelf is not the
 * same act as walking out of a lesson — and like every other move it clears
 * the level estimate, because evidence about somewhere they no longer are is
 * not evidence.
 *
 * Returns null when they are already standing there, so a caller can tell a
 * no-op from a move and not write a row that changes nothing.
 */
export function switchToMiniLevel(
  state: LearnerState,
  miniLevel: number,
): Moved | null {
  if (miniLevel === state.miniLevel) return null;

  return {
    state: placedAt(state, miniLevel),
    level: getMiniLevel(miniLevel),
    from: state.miniLevel,
    to: miniLevel,
  };
}

/**
 * Moves the learner on one level because they asked to.
 *
 * The level being left is recorded as skipped rather than mastered. A learner
 * is allowed to move on from something that bores them — a level they will
 * not sit through is worth less than one they walk past — but the dashboard
 * and the tutor both have to be able to tell the two apart afterwards, and a
 * figure that quietly means either is a figure that means neither.
 *
 * Returns null at the end of the path: B1 mini-level 70 has no successor, and
 * promising a B2 the product does not teach would be a lie.
 */
export function advanceOnRequest(state: LearnerState): Moved | null {
  if (state.miniLevel >= MAX_MINI_LEVEL) return null;

  const to = state.miniLevel + 1;
  const skipped = state.skippedMiniLevels.includes(state.miniLevel)
    ? state.skippedMiniLevels
    : [...state.skippedMiniLevels, state.miniLevel];

  return {
    state: { ...placedAt(state, to), skippedMiniLevels: skipped },
    level: getMiniLevel(to),
    from: state.miniLevel,
    to,
  };
}

/** Whether the learner reached where they are by asking rather than earning. */
export function wasSkipped(state: LearnerState, miniLevel: number): boolean {
  return state.skippedMiniLevels.includes(miniLevel);
}

/**
 * The mastery gate itself lives in learning/mastery.ts — a leaf module,
 * because the chat page draws the same arithmetic as a progress bar and must
 * not pull the authored curriculum into the client bundle to do it. Re-said
 * here so the callers that think of it as progression keep one import.
 */
export {
  MASTERY_MIN_TURNS,
  MASTERY_RATIO,
  hasMastered,
  isStrongTurn,
} from "./mastery";

/**
 * Moves the learner on one level because they earned it.
 *
 * The mirror of advanceOnRequest with the bookkeeping reversed: the level
 * being left is not recorded as skipped — it was mastered, which is the whole
 * point — and if it was ever skipped in the past, that mark is removed. A
 * learner who walked past a level once and has now come back and beaten it
 * has un-skipped it, and a record that still said otherwise would be a record
 * of somewhere they no longer are.
 *
 * Returns null at the end of the path, same as asking does.
 */
export function advanceOnMastery(state: LearnerState): Moved | null {
  if (state.miniLevel >= MAX_MINI_LEVEL) return null;

  const to = state.miniLevel + 1;
  const mastered = state.miniLevel;

  return {
    state: {
      ...placedAt(state, to),
      skippedMiniLevels: state.skippedMiniLevels.filter(
        (level) => level !== mastered,
      ),
    },
    level: getMiniLevel(to),
    from: mastered,
    to,
  };
}

/**
 * Whether a message is asking to move on.
 *
 * Deterministic, and it has to be. A model deciding this would be a learner's
 * untrusted text carrying authority over a business rule, which is the thing
 * the prompt catalogue says a prompt is never allowed to be the control for.
 *
 * Deliberately narrow. A learner saying "das nächste Wort bitte" wants a word,
 * not a new syllabus, so the patterns want an explicit move: a bare "weiter",
 * or something that names moving on, the next level, or being finished here.
 * Anything vaguer is left to be an ordinary sentence, because moving somebody
 * who did not ask is worse than not moving somebody who did.
 */
const ADVANCE_PATTERNS: readonly RegExp[] = [
  // A bare request, the whole message: "weiter", "next", "next please".
  /^\s*(weiter|nächste[sr]?|next)( bitte| please)?[.!]?\s*$/iu,
  // Naming the move explicitly.
  /\b(move (me )?(on|to (the )?next)|moving on|go on to the next|skip (this|ahead)|next (level|lesson|topic|exercise|unit))\b/iu,
  /\b(zum nächsten (level|thema|kapitel)|nächstes (level|thema|kapitel)|weitermachen|weiter machen)\b/iu,
  // `\b` is ASCII-only even under the u flag, so a word starting with an
  // umlaut has no boundary before it and `\büberspringen` never matches.
  /(?<!\p{L})überspringen(?!\p{L})/iu,
  // "I want to move to next", and the ways people actually write it.
  /\b(i (want|would like) to (move|go) (on|to)|can we move on|let'?s move on|ready for the next)\b/iu,
  // Being finished here — anchored to the end of the message, because "ich bin
  // fertig mit meinem Kaffee" is a learner talking, not a learner asking.
  /\b(i(?:'|’)?m done( with (this|it|here))?|ich bin fertig( damit| hier)?|das kann ich schon)\s*[.!?]?\s*$/iu,
];

/**
 * Messages that name moving on while plainly being about something else.
 *
 * Checked first and absolutely. "Was heißt weitermachen auf Englisch?" is a
 * vocabulary question that happens to contain the word — moving a learner who
 * asked what a word means would take away their place in the syllabus as the
 * answer to a question about spelling.
 */
const NOT_A_REQUEST: readonly RegExp[] = [
  /\b(was (heißt|bedeutet)|wie sagt man|was ist (der unterschied|ein|eine))\b/iu,
  /\b(what does .* mean|how do you say|translate|auf englisch|in english|übersetz)\b/iu,
];

export function asksToAdvance(message: string): boolean {
  const text = message.trim();
  if (text.length === 0) return false;
  if (NOT_A_REQUEST.some((pattern) => pattern.test(text))) return false;

  return ADVANCE_PATTERNS.some((pattern) => pattern.test(text));
}
