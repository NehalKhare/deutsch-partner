import { z } from "zod";

import {
  cefrForMiniLevelOrNull,
  cefrLevelSchema,
  miniLevelSchema,
} from "@/domain/cefr";
import {
  nonEmptyTextSchema,
  timestampSchema,
  unitIntervalSchema,
  uuidSchema,
} from "@/domain/primitives";

export const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "article",
  "numeral",
  "interjection",
  "phrase",
] as const;

export const GENDERS = ["der", "die", "das"] as const;

export const VOCABULARY_STATUSES = [
  "new",
  "introduced",
  "learning",
  "familiar",
  "mastered",
  "weak",
] as const;

export const vocabularyStatusSchema = z.enum(VOCABULARY_STATUSES);
export type VocabularyStatus = z.infer<typeof vocabularyStatusSchema>;

export const vocabularyItemSchema = z
  .object({
    id: uuidSchema,
    lemma: nonEmptyTextSchema(64),
    word: nonEmptyTextSchema(96),
    partOfSpeech: z.enum(PARTS_OF_SPEECH),
    gender: z.enum(GENDERS).nullable(),
    plural: nonEmptyTextSchema(96).nullable(),
    englishTranslation: nonEmptyTextSchema(200),
    germanDefinition: nonEmptyTextSchema(500),
    example: nonEmptyTextSchema(300),
    collocations: z.array(nonEmptyTextSchema(120)).max(20),
    commonMistakes: z.array(nonEmptyTextSchema(200)).max(20),
    cefr: cefrLevelSchema,
    miniLevel: miniLevelSchema,
    topic: nonEmptyTextSchema(64),
    frequencyBand: z.number().int().min(1).max(10),
    isCoreWord: z.boolean(),
  })
  // Gender is a property of German nouns specifically. Storing one on a verb
  // means the row was built wrong, and it would mislead the tutor.
  .refine((item) => (item.partOfSpeech === "noun") === (item.gender !== null), {
    error: "gender is required on nouns and forbidden elsewhere",
    path: ["gender"],
  })
  .refine(
    (item) => {
      const derived = cefrForMiniLevelOrNull(item.miniLevel);
      return derived === null || derived === item.cefr;
    },
    {
      error: "cefr does not match the mini-level this word is introduced at",
      path: ["cefr"],
    },
  );

export type VocabularyItem = z.infer<typeof vocabularyItemSchema>;

/** Statuses that assert the learner can actually use the word. */
const CONFIDENT_STATUSES = new Set<VocabularyStatus>(["mastered", "familiar"]);
const MIN_MASTERY_FOR_CONFIDENT_STATUS = 0.6;

export const learnerVocabularySchema = z
  .object({
    learnerId: uuidSchema,
    vocabularyItemId: uuidSchema,
    exposureCount: z.number().int().min(0),
    correctCount: z.number().int().min(0),
    incorrectCount: z.number().int().min(0),
    masteryScore: unitIntervalSchema,
    confidence: unitIntervalSchema,
    lastSeenAt: timestampSchema.nullable(),
    nextReviewAt: timestampSchema.nullable(),
    status: vocabularyStatusSchema,
  })
  .refine(
    (record) =>
      record.correctCount + record.incorrectCount <= record.exposureCount,
    {
      error: "recorded uses cannot exceed exposures",
      path: ["exposureCount"],
    },
  )
  // Exposure is not mastery. A record cannot claim a confident status while
  // its own mastery score says the learner is still struggling.
  .refine(
    (record) =>
      !CONFIDENT_STATUSES.has(record.status) ||
      record.masteryScore >= MIN_MASTERY_FOR_CONFIDENT_STATUS,
    {
      error: "status claims competence that the mastery score contradicts",
      path: ["status"],
    },
  );

export type LearnerVocabulary = z.infer<typeof learnerVocabularySchema>;
