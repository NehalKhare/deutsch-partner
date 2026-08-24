import {
  cefrForMiniLevel,
  miniLevelSchema,
  type CEFRLevel,
} from "@/domain/cefr";
import type {
  MasteryCriteria,
  MiniLevelDefinition,
  ReviewRequirements,
} from "@/domain/mini-level";
import { CURRICULUM_ENTRIES, type CurriculumEntry } from "@/learning/curriculum";
import { GRAMMAR_LABELS } from "@/learning/grammar-labels";

/**
 * The mini-level engine.
 *
 * Themes, words, grammar and functions are authored per level in
 * learning/curriculum.ts. Everything else — goals, thresholds, activities — is
 * derived here from the band the level sits in, for two reasons: seventy
 * hand-written threshold sets would drift apart, and a learner deserves the
 * same standard at mini-level 12 as at mini-level 13.
 */

/** How much of a level's own vocabulary must be at mastered to move on. */
const MASTERY_RATIO: Readonly<Record<CEFRLevel, number>> = {
  A1: 0.7,
  A2: 0.75,
  B1: 0.8,
};

const ACCURACY_TARGET: Readonly<Record<CEFRLevel, number>> = {
  A1: 0.6,
  A2: 0.7,
  B1: 0.75,
};

const PRODUCTIVE_TURNS: Readonly<Record<CEFRLevel, number>> = {
  A1: 6,
  A2: 10,
  B1: 14,
};

const REVIEW: Readonly<Record<CEFRLevel, ReviewRequirements>> = {
  A1: { minReviewItems: 5, maxOverdueItems: 10 },
  A2: { minReviewItems: 10, maxOverdueItems: 15 },
  B1: { minReviewItems: 15, maxOverdueItems: 20 },
};

/** How the listening a level asks for is described to the learner. */
const LISTENING: Readonly<Record<CEFRLevel, string>> = {
  A1: "slow, clearly spoken",
  A2: "normally paced",
  B1: "natural, unscripted",
};

function label(slug: string): string {
  // Falling back to the slug keeps a goal readable if a label is ever missing;
  // a test makes sure that never reaches a learner.
  return GRAMMAR_LABELS[slug] ?? slug.replaceAll("_", " ");
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function masteryCriteriaFor(
  entry: CurriculumEntry,
  cefr: CEFRLevel,
): MasteryCriteria {
  return {
    vocabularyMastered: Math.max(
      1,
      Math.ceil(entry.vocabulary.length * MASTERY_RATIO[cefr]),
    ),
    grammarAccuracy: ACCURACY_TARGET[cefr],
    comprehensionScore: ACCURACY_TARGET[cefr],
    productiveTurns: PRODUCTIVE_TURNS[cefr],
  };
}

function toDefinition(
  entry: CurriculumEntry,
  index: number,
): MiniLevelDefinition {
  const miniLevel = index + 1;
  const cefr = cefrForMiniLevel(miniLevel);
  const leadGrammar = label(entry.grammar[0]);
  const masteryCriteria = masteryCriteriaFor(entry, cefr);

  return {
    miniLevel,
    cefr,
    theme: entry.theme,
    focus: entry.focus,
    targetVocabulary: entry.vocabulary,
    targetGrammar: entry.grammar,
    conversationFunctions: entry.functions,
    comprehensionGoals: [
      `Follow a ${LISTENING[cefr]} conversation about ${entry.focus}.`,
      `Notice ${leadGrammar} while listening, without translating first.`,
    ],
    productionGoals: [
      `${sentenceCase(entry.functions[0])} without rehearsing the sentence first.`,
      `Use ${leadGrammar} correctly across ${masteryCriteria.productiveTurns} turns.`,
    ],
    masteryCriteria,
    reviewRequirements: REVIEW[cefr],
    recommendedActivities: [
      `Role-play: ${entry.functions[0]}.`,
      `Guided conversation about ${entry.focus}.`,
      `Focused practice on ${leadGrammar}.`,
    ],
  };
}

/** The full path, in order. Index n holds mini-level n + 1. */
export const MINI_LEVEL_CURRICULUM: readonly MiniLevelDefinition[] =
  Object.freeze(CURRICULUM_ENTRIES.map(toDefinition));

/**
 * The definition for a level on the path.
 *
 * Throws on a level that does not exist, because that is a programming error
 * rather than a learner input. Use findMiniLevel for anything that arrived
 * from outside the application.
 */
export function getMiniLevel(miniLevel: number): MiniLevelDefinition {
  const parsed = miniLevelSchema.parse(miniLevel);

  return MINI_LEVEL_CURRICULUM[parsed - 1];
}

/** The non-throwing variant, for values that came from outside. */
export function findMiniLevel(miniLevel: unknown): MiniLevelDefinition | null {
  const parsed = miniLevelSchema.safeParse(miniLevel);

  return parsed.success ? MINI_LEVEL_CURRICULUM[parsed.data - 1] : null;
}

/** Where the learner is now, read from their state rather than guessed. */
export function getCurrentMiniLevel(state: {
  readonly miniLevel: number;
}): MiniLevelDefinition {
  return getMiniLevel(state.miniLevel);
}

/**
 * The level after this one, or null at the top of the path.
 *
 * B1 is where the product stops, so mini-level 70 has no successor. Returning
 * null rather than clamping keeps callers from silently promising a B2 that
 * does not exist.
 */
export function getNextMiniLevel(
  miniLevel: number,
): MiniLevelDefinition | null {
  const parsed = miniLevelSchema.parse(miniLevel);

  return parsed === MINI_LEVEL_CURRICULUM.length
    ? null
    : MINI_LEVEL_CURRICULUM[parsed];
}
