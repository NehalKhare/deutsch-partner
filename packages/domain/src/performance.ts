import { z } from "zod";

import { miniLevelSchema } from "./cefr";
import { timestampSchema, unitIntervalSchema, uuidSchema } from "./primitives";

/**
 * How a learner performed at one mini-level.
 *
 * This is the long-term memory the product keeps of a conversation. The words
 * themselves are never written anywhere — a practice session lives in the
 * learner's browser and dies with the tab — so what survives is the only thing
 * the product needs to remember: how many evaluated turns the level took, how
 * many of them were error-free, and the score those two numbers make.
 *
 * The score is stored by the database as a generated column rather than
 * computed here, so a row read back cannot disagree with its own tally.
 */
export const levelPerformanceSchema = z
  .strictObject({
    learnerId: uuidSchema,
    miniLevel: miniLevelSchema,
    /** Evaluated turns at this level. Formulaic one-worders never count. */
    turns: z.number().int().min(0),
    /** Turns the evaluation found no errors in. */
    strongTurns: z.number().int().min(0),
    /** strongTurns / turns, from the database's own generated column. */
    score: unitIntervalSchema,
    updatedAt: timestampSchema,
  })
  .refine((performance) => performance.strongTurns <= performance.turns, {
    error: "a level cannot have more strong turns than turns",
    path: ["strongTurns"],
  });

export type LevelPerformance = z.infer<typeof levelPerformanceSchema>;
