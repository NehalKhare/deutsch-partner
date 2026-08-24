import { z } from "zod";

import { nonEmptyTextSchema, unitIntervalSchema } from "@/domain/primitives";

/**
 * The scenario model.
 *
 * A scenario is one of exactly two things, and everything about the feature
 * hangs off that distinction: a **dialogue** is a speaker-tagged German
 * script practised as an AI roleplay, a **comprehension** is a German
 * passage answered as a quiz. The discriminated union carries the rule, so
 * a dialogue physically cannot arrive without lines to speak and a
 * comprehension cannot arrive without questions to answer.
 *
 * Levels are the corpus's own band, not the product path: the dataset
 * carries B2 material even though the taught path stops at B1, and hiding
 * that here would misdescribe every B2 card. `domain/cefr.ts` stays the
 * authority on what is *taught*; this is what can be *practised*.
 */

export const SCENARIO_TYPES = ["dialogue", "comprehension"] as const;
export const scenarioTypeSchema = z.enum(SCENARIO_TYPES);
export type ScenarioType = z.infer<typeof scenarioTypeSchema>;

export const SCENARIO_KINDS = [
  "dialogue",
  "reading",
  "telephone",
  "announcement",
] as const;
export const scenarioKindSchema = z.enum(SCENARIO_KINDS);
export type ScenarioKind = z.infer<typeof scenarioKindSchema>;

export const SCENARIO_LEVELS = ["A1", "A2", "B1", "B2"] as const;
export const scenarioLevelSchema = z.enum(SCENARIO_LEVELS);
export type ScenarioLevel = z.infer<typeof scenarioLevelSchema>;

/** The search box's ceiling. Longer input is rejected, never truncated. */
export const MAX_SCENARIO_QUERY_LENGTH = 200;

export const dialogueLineSchema = z.object({
  speaker: nonEmptyTextSchema(64),
  german: nonEmptyTextSchema(1000),
  english: z.string().max(1000).default(""),
});
export type DialogueLine = z.infer<typeof dialogueLineSchema>;

export const dialogueContentSchema = z.object({
  setting: z.string().max(1000).default(""),
  lines: z.array(dialogueLineSchema).min(1).max(100),
});
export type DialogueContent = z.infer<typeof dialogueContentSchema>;

export const comprehensionQuestionSchema = z.object({
  question: nonEmptyTextSchema(1000),
  answer: nonEmptyTextSchema(1000),
});
export type ComprehensionQuestion = z.infer<typeof comprehensionQuestionSchema>;

export const comprehensionContentSchema = z.object({
  passage: nonEmptyTextSchema(8000),
  passageEnglish: z.string().max(8000).nullable().default(null),
  questions: z.array(comprehensionQuestionSchema).min(1).max(20),
});
export type ComprehensionContent = z.infer<typeof comprehensionContentSchema>;

export const vocabularyGlossSchema = z.object({
  term: nonEmptyTextSchema(120),
  meaning: nonEmptyTextSchema(200),
});
export type VocabularyGloss = z.infer<typeof vocabularyGlossSchema>;

const scenarioBase = z.object({
  id: z.number().int().positive(),
  slug: nonEmptyTextSchema(200),
  kind: scenarioKindSchema,
  title: nonEmptyTextSchema(200),
  titleEnglish: nonEmptyTextSchema(200),
  description: nonEmptyTextSchema(1000),
  targetLevel: scenarioLevelSchema,
  // The citation: which dataset document this came from, and where in it.
  // Required, because retrieved content that cannot say where it came from
  // cannot be checked against its source.
  source: nonEmptyTextSchema(200),
  itemIndex: z.number().int().min(0),
  vocabulary: z.array(vocabularyGlossSchema).max(30).default([]),
});

export const scenarioSchema = z.discriminatedUnion("type", [
  scenarioBase.extend({
    type: z.literal("dialogue"),
    content: dialogueContentSchema,
  }),
  scenarioBase.extend({
    type: z.literal("comprehension"),
    content: comprehensionContentSchema,
  }),
]);
export type Scenario = z.infer<typeof scenarioSchema>;

/**
 * What a card needs: identity, metadata and its citation, never the body.
 * Search results carry a similarity in 0..1; a browsed grid carries none.
 */
export const scenarioSummarySchema = z.object({
  id: z.number().int().positive(),
  slug: nonEmptyTextSchema(200),
  type: scenarioTypeSchema,
  kind: scenarioKindSchema,
  title: nonEmptyTextSchema(200),
  titleEnglish: nonEmptyTextSchema(200),
  description: nonEmptyTextSchema(1000),
  targetLevel: scenarioLevelSchema,
  source: nonEmptyTextSchema(200),
  itemIndex: z.number().int().min(0),
  similarity: unitIntervalSchema.optional(),
});
export type ScenarioSummary = z.infer<typeof scenarioSummarySchema>;
