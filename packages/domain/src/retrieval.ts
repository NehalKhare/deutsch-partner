import { z } from "zod";

import {
  cefrForMiniLevelOrNull,
  cefrLevelSchema,
  miniLevelSchema,
} from "./cefr";
import { grammarPatternKeySchema } from "./grammar";
import { errorTypeSchema } from "./learner-error";
import { nonEmptyTextSchema } from "./primitives";

/**
 * The kinds of pedagogical content the corpus holds.
 *
 * Closed, and identical to the check constraint on knowledge_documents. It
 * drives the chunking targets, the retrieval filters and the intent routing,
 * so an ingestion run that invents a type would produce chunks nothing ever
 * asks for.
 */
export const KNOWLEDGE_CONTENT_TYPES = [
  "curriculum",
  "vocabulary",
  "sentence_pattern",
  "grammar",
  "situation",
  "conversation_function",
  "culture",
  "dialogue",
  "mistake_pattern",
] as const;

export const knowledgeContentTypeSchema = z.enum(KNOWLEDGE_CONTENT_TYPES);
export type KnowledgeContentType = z.infer<typeof knowledgeContentTypeSchema>;

/** Where a question should be answered from. */
export const RETRIEVAL_INTENTS = [
  "vocabulary",
  "grammar",
  "conversation",
  "culture",
  "web",
] as const;

export const retrievalIntentSchema = z.enum(RETRIEVAL_INTENTS);
export type RetrievalIntent = z.infer<typeof retrievalIntentSchema>;

/**
 * Retrieval is never driven by the raw user sentence alone. This is the
 * learner-aware context every retrieval request is filtered by.
 *
 * The list caps are a token-budget concern as much as a data-hygiene one: this
 * context is rendered into a prompt with a fixed budget.
 */
export const retrievalContextSchema = z
  .object({
    intent: retrievalIntentSchema,
    cefr: cefrLevelSchema,
    miniLevel: miniLevelSchema,
    topic: nonEmptyTextSchema(64).optional(),
    skill: nonEmptyTextSchema(64).optional(),
    weakGrammarKeys: z.array(grammarPatternKeySchema).max(20).default([]),
    recurringErrorTypes: z.array(errorTypeSchema).max(20).default([]),
    targetVocabularyLemmas: z.array(nonEmptyTextSchema(64)).max(50).default([]),
    currentLessonTarget: nonEmptyTextSchema(200).optional(),
  })
  .refine(
    (context) => {
      const derived = cefrForMiniLevelOrNull(context.miniLevel);
      return derived === null || derived === context.cefr;
    },
    {
      error: "cefr does not match the mini-level being retrieved for",
      path: ["cefr"],
    },
  );

export type RetrievalContext = z.infer<typeof retrievalContextSchema>;
