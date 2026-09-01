import { z } from "zod";

import {
  nonEmptyTextSchema,
  timestampSchema,
  uuidSchema,
} from "@/domain/primitives";

const MAX_PATTERN_LENGTH = 300;
const MAX_UTTERANCE_LENGTH = 500;

/**
 * A closed taxonomy. Error types drive review scheduling, recommendation
 * ranking and retrieval filters, so an open string field would let a model
 * invent categories nothing downstream can act on.
 */
export const ERROR_TYPES = [
  "word_order",
  "gender",
  "case_nominative",
  "case_accusative",
  "case_dative",
  "verb_conjugation",
  "modal_verb",
  "separable_verb",
  "perfekt",
  "subordinate_clause",
  "relative_clause",
  "adjective_ending",
  "preposition",
  "reflexive_verb",
  "article",
  "plural_form",
  "vocabulary_choice",
  "spelling",
  "register_formality",
] as const;

export const errorTypeSchema = z.enum(ERROR_TYPES);
export type ErrorType = z.infer<typeof errorTypeSchema>;

export const MAX_STORED_EXAMPLES = 20;

export const learnerErrorSchema = z
  .object({
    id: uuidSchema,
    learnerId: uuidSchema,
    errorType: errorTypeSchema,
    pattern: nonEmptyTextSchema(300),
    occurrenceCount: z.number().int().min(1),
    firstSeenAt: timestampSchema,
    lastSeenAt: timestampSchema,
    resolved: z.boolean(),
    // Capped: this record aggregates a recurring pattern, it is not a log.
    exampleUtterances: z
      .array(nonEmptyTextSchema(500))
      .max(MAX_STORED_EXAMPLES),
  })
  .refine((error) => error.lastSeenAt >= error.firstSeenAt, {
    error: "lastSeenAt precedes firstSeenAt",
    path: ["lastSeenAt"],
  });

export type LearnerError = z.infer<typeof learnerErrorSchema>;

/**
 * The aggregation key.
 *
 * The pattern is a short description written by a model, so the same mistake
 * arrives worded with different spacing, casing and punctuation from one turn
 * to the next. Without this, every turn would open a new row and nothing would
 * ever reach a count worth acting on.
 */
export function normaliseErrorPattern(pattern: string): string {
  return pattern
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/u, "")
    .trim()
    .toLowerCase();
}

export const errorObservationSchema = z.strictObject({
  learnerId: uuidSchema,
  errorType: errorTypeSchema,
  pattern: z
    .string()
    .max(MAX_PATTERN_LENGTH)
    .transform(normaliseErrorPattern)
    .pipe(nonEmptyTextSchema(MAX_PATTERN_LENGTH)),
  /** What the learner actually said. Optional: not every report carries one. */
  utterance: nonEmptyTextSchema(MAX_UTTERANCE_LENGTH).optional(),
  observedAt: z.date(),
});

export type ErrorObservation = z.infer<typeof errorObservationSchema>;
