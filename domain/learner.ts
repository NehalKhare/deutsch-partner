import { z } from "zod";

import {
  MAX_MINI_LEVEL,
  cefrForMiniLevelOrNull,
  cefrLevelSchema,
  effectiveLevelSchema,
  miniLevelSchema,
  type CEFRLevel,
  type EffectiveLevel,
} from "@/domain/cefr";
import {
  nonEmptyTextSchema,
  timestampSchema,
  unitIntervalSchema,
  uuidSchema,
} from "@/domain/primitives";
import { VOICE_GENDERS } from "@/domain/tutor";

export const INPUT_MODES = ["text", "voice"] as const;
export const CORRECTION_PREFERENCES = ["gentle", "explicit", "minimal"] as const;

/**
 * The pass marks a learner may set for moving up: the share of evaluated
 * turns that must be error-free before a mini-level counts as cleared.
 *
 * A closed set rather than a free percentage, because each value is a
 * position on how to learn — relaxed, balanced, thorough — and a database
 * CHECK can hold a set where it could not hold an opinion. 80 is the default
 * and the bar the product recommends; the five-evaluated-turn minimum is not
 * negotiable at any setting.
 */
export const MASTERY_THRESHOLDS = [33, 50, 80] as const;
export type MasteryThreshold = (typeof MASTERY_THRESHOLDS)[number];

export const masteryThresholdSchema = z.union([
  z.literal(33),
  z.literal(50),
  z.literal(80),
]);

/**
 * Onboarding-time preferences. Strict, because this arrives from a form and an
 * unexpected property is a sign of tampering rather than of a new feature.
 */
export const learnerProfileSchema = z.strictObject({
  id: uuidSchema,
  nativeLanguage: nonEmptyTextSchema(16),
  learningGoal: nonEmptyTextSchema(500),
  selectedLevel: cefrLevelSchema,
  targetTopics: z.array(nonEmptyTextSchema(64)).max(20),
  interests: z.array(nonEmptyTextSchema(64)).max(20),
  inputPreference: z.enum(INPUT_MODES),
  outputPreference: z.enum(INPUT_MODES),
  correctionPreference: z.enum(CORRECTION_PREFERENCES),
  /**
   * Which voice reads replies aloud. Defaulted rather than required, because
   * the column arrived after the first profiles did — an old row without it
   * is a learner who has not chosen, which is exactly what the default means.
   */
  voicePreference: z.enum(VOICE_GENDERS).default("male"),
  /**
   * The pass mark for clearing a mini-level, as a percentage of evaluated
   * turns that were error-free. Defaulted for the same reason as the voice:
   * a profile from before the column is a learner who has not chosen, and
   * the default is the bar the product has always set.
   */
  masteryThreshold: masteryThresholdSchema.default(80),
});

export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

/**
 * Confidence at which a learner is treated as operating comfortably within
 * their level rather than merely reaching it.
 */
const PLUS_CONFIDENCE_THRESHOLD = 0.8;

/**
 * The learner's selection is a preference; the estimate is evidence. Effective
 * level follows the evidence, and the selection is left untouched so the
 * product never silently overrides what the learner asked for.
 */
export function deriveEffectiveLevel(input: {
  readonly selectedLevel: CEFRLevel;
  readonly estimatedLevel: CEFRLevel | null;
  readonly confidence: number;
}): EffectiveLevel {
  const cefr = input.estimatedLevel ?? input.selectedLevel;
  const plus =
    input.estimatedLevel !== null &&
    input.confidence >= PLUS_CONFIDENCE_THRESHOLD &&
    cefr !== "B1";

  return { cefr, plus };
}

export const learnerStateSchema = z
  .object({
    learnerId: uuidSchema,
    selectedLevel: cefrLevelSchema,
    estimatedLevel: cefrLevelSchema.nullable(),
    effectiveLevel: effectiveLevelSchema,
    miniLevel: miniLevelSchema,
    /**
     * The highest mini-level this learner has ever occupied, however they got
     * there. It is what lets a level toggle put them back where they were
     * rather than at the start of a band they are halfway through.
     */
    furthestMiniLevel: miniLevelSchema,
    /**
     * Levels moved past on request rather than mastered.
     *
     * Recorded because a learner is allowed to skip — a level that bores them
     * is a level they stop showing up for — but the product must not then
     * report a skipped level and an earned one as the same thing.
     */
    skippedMiniLevels: z.array(miniLevelSchema).max(MAX_MINI_LEVEL),
    fluency: unitIntervalSchema,
    comprehension: unitIntervalSchema,
    confidence: unitIntervalSchema,
    updatedAt: timestampSchema,
  })
  .refine(
    (state) => {
      const derived = cefrForMiniLevelOrNull(state.miniLevel);
      return derived === null || derived === state.effectiveLevel.cefr;
    },
    {
      error:
        "mini-level and effective level disagree about where the learner is",
      path: ["miniLevel"],
    },
  )
  .refine((state) => state.furthestMiniLevel >= state.miniLevel, {
    error: "a learner cannot be further along the path than they have ever been",
    path: ["furthestMiniLevel"],
  })
  .refine(
    (state) => new Set(state.skippedMiniLevels).size === state.skippedMiniLevels.length,
    {
      error: "the same level cannot have been skipped twice",
      path: ["skippedMiniLevels"],
    },
  );

export type LearnerState = z.infer<typeof learnerStateSchema>;
