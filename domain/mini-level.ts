import { z } from "zod";

import {
  cefrForMiniLevelOrNull,
  cefrLevelSchema,
  miniLevelSchema,
} from "@/domain/cefr";
import { nonEmptyTextSchema, unitIntervalSchema } from "@/domain/primitives";

/**
 * The mini-level: the unit a learner actually moves through.
 *
 * A CEFR level is too coarse to act on — "A2" spans months. A mini-level is
 * small enough to finish, and it carries the two things the rest of the system
 * needs: what is being taught, and what counts as done. Both live here rather
 * than in the database so the rule can be tested without one.
 */

const textList = (max: number, cap: number) =>
  z.array(nonEmptyTextSchema(max)).min(1).max(cap).readonly();

/**
 * What a learner must show before the level is behind them.
 *
 * Every field is a floor, and none of them is optional. A level with no
 * threshold is a level nobody can fail, which is worse than no level at all:
 * it moves people up on time served rather than on evidence.
 */
export const masteryCriteriaSchema = z.strictObject({
  /** Words from this level's own target list held at mastered. */
  vocabularyMastered: z.number().int().min(1),
  /** Share of uses of this level's grammar that were correct. */
  grammarAccuracy: unitIntervalSchema,
  /** Share of comprehension checks answered correctly. */
  comprehensionScore: unitIntervalSchema,
  /** Turns the learner produced using this level's functions. */
  productiveTurns: z.number().int().min(1),
});

export type MasteryCriteria = z.infer<typeof masteryCriteriaSchema>;

/**
 * The debt from earlier levels that must be settled before moving on.
 *
 * Advancing with a large overdue backlog is how a learner ends up nominally at
 * B1 while the A2 material quietly rots, so the backlog is a gate rather than
 * a suggestion.
 */
export const reviewRequirementsSchema = z.strictObject({
  minReviewItems: z.number().int().min(0),
  maxOverdueItems: z.number().int().min(0),
});

export type ReviewRequirements = z.infer<typeof reviewRequirementsSchema>;

export const miniLevelDefinitionSchema = z
  .strictObject({
    miniLevel: miniLevelSchema,
    cefr: cefrLevelSchema,
    /** The learner-facing title, in German. */
    theme: nonEmptyTextSchema(80),
    /** The same thing in English, phrased to drop into a sentence. */
    focus: nonEmptyTextSchema(120),
    targetVocabulary: textList(60, 30),
    /** Slugs, so they join to grammar_patterns.key rather than to prose. */
    targetGrammar: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .min(1)
      .max(10)
      .readonly(),
    /**
     * Culture-note slugs taught at this level — du/Sie, register, politeness.
     * The same key space as grammar (they share the catalogue table); most
     * levels teach none, so the list may be empty where grammar's may not.
     */
    targetCulture: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .max(3)
      .readonly(),
    conversationFunctions: textList(120, 10),
    comprehensionGoals: textList(200, 6),
    productionGoals: textList(200, 6),
    masteryCriteria: masteryCriteriaSchema,
    reviewRequirements: reviewRequirementsSchema,
    recommendedActivities: textList(200, 6),
  })
  .refine(
    (level) => {
      const derived = cefrForMiniLevelOrNull(level.miniLevel);
      return derived === null || derived === level.cefr;
    },
    {
      error: "the CEFR level and the mini-level disagree about the band",
      path: ["cefr"],
    },
  );

export type MiniLevelDefinition = z.infer<typeof miniLevelDefinitionSchema>;

/** What the learner has actually done at the level they are on. */
export const miniLevelProgressSchema = z.strictObject({
  vocabularyMastered: z.number().int().min(0),
  grammarAccuracy: unitIntervalSchema,
  comprehensionScore: unitIntervalSchema,
  productiveTurns: z.number().int().min(0),
  reviewItemsCleared: z.number().int().min(0),
  overdueReviewItems: z.number().int().min(0),
});

export type MiniLevelProgress = z.infer<typeof miniLevelProgressSchema>;

export interface UnmetCriterion {
  readonly criterion: keyof MiniLevelProgress;
  readonly direction: "at_least" | "at_most";
  readonly required: number;
  readonly actual: number;
}

/**
 * Accuracy targets are compared with a tolerance.
 *
 * Progress figures are computed — 0.1 + 0.2 is not 0.3 in binary floating
 * point — and a learner who has done exactly what was asked must not be held
 * back by the last bit of a double.
 */
const TOLERANCE = 1e-9;

/**
 * Every criterion the learner has not yet met, in the order they are shown.
 *
 * The list, rather than a bare boolean, is what the interface needs: "three
 * more words" is actionable where "not yet" is not.
 */
export function unmetMasteryCriteria(
  definition: MiniLevelDefinition,
  progress: MiniLevelProgress,
): readonly UnmetCriterion[] {
  const level = miniLevelDefinitionSchema.parse(definition);
  const done = miniLevelProgressSchema.parse(progress);
  const { masteryCriteria, reviewRequirements } = level;

  const floors: ReadonlyArray<[keyof MiniLevelProgress, number]> = [
    ["vocabularyMastered", masteryCriteria.vocabularyMastered],
    ["grammarAccuracy", masteryCriteria.grammarAccuracy],
    ["comprehensionScore", masteryCriteria.comprehensionScore],
    ["productiveTurns", masteryCriteria.productiveTurns],
    ["reviewItemsCleared", reviewRequirements.minReviewItems],
  ];

  const unmet: UnmetCriterion[] = [];

  for (const [criterion, required] of floors) {
    if (done[criterion] + TOLERANCE < required) {
      unmet.push({
        criterion,
        direction: "at_least",
        required,
        actual: done[criterion],
      });
    }
  }

  // The one ceiling: a backlog is a reason to stay, not a target to reach.
  if (done.overdueReviewItems > reviewRequirements.maxOverdueItems) {
    unmet.push({
      criterion: "overdueReviewItems",
      direction: "at_most",
      required: reviewRequirements.maxOverdueItems,
      actual: done.overdueReviewItems,
    });
  }

  return unmet;
}

export function isMiniLevelComplete(
  definition: MiniLevelDefinition,
  progress: MiniLevelProgress,
): boolean {
  return unmetMasteryCriteria(definition, progress).length === 0;
}
