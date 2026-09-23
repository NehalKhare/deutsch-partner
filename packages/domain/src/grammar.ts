import { z } from "zod";

import {
  cefrForMiniLevelOrNull,
  cefrLevelSchema,
  miniLevelSchema,
} from "./cefr";
import { nonEmptyTextSchema, uuidSchema } from "./primitives";

/** Stable snake_case identifier, referenced by retrieval filters and prompts. */
export const grammarPatternKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, {
    error: "must be snake_case so the key stays stable and referenceable",
  })
  .max(64);

/**
 * What kind of teaching a pattern is. Culture and pragmatics notes — du/Sie,
 * register, politeness — live in the same catalogue and flow through the same
 * teach machinery; the category is what lets the trainer's agenda give them a
 * slot of their own.
 */
export const grammarPatternCategorySchema = z.enum(["grammar", "culture"]);

export type GrammarPatternCategory = z.infer<typeof grammarPatternCategorySchema>;

export const grammarPatternSchema = z
  .object({
    id: uuidSchema,
    key: grammarPatternKeySchema,
    name: nonEmptyTextSchema(120),
    explanation: nonEmptyTextSchema(2000),
    examples: z.array(nonEmptyTextSchema(300)).min(1).max(20).readonly(),
    cefr: cefrLevelSchema,
    miniLevel: miniLevelSchema,
    difficulty: z.number().int().min(1).max(5),
    commonMistakes: z.array(nonEmptyTextSchema(300)).max(20).readonly(),
    relatedPatternKeys: z.array(grammarPatternKeySchema).max(20).readonly(),
    category: grammarPatternCategorySchema,
  })
  .refine(
    (pattern) => {
      const derived = cefrForMiniLevelOrNull(pattern.miniLevel);
      return derived === null || derived === pattern.cefr;
    },
    {
      error: "cefr does not match the mini-level this pattern is taught at",
      path: ["cefr"],
    },
  )
  .refine((pattern) => !pattern.relatedPatternKeys.includes(pattern.key), {
    error: "a pattern cannot be related to itself",
    path: ["relatedPatternKeys"],
  });

export type GrammarPattern = z.infer<typeof grammarPatternSchema>;
