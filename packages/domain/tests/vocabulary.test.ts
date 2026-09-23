import { describe, expect, it } from "vitest";
import {
  VOCABULARY_STATUSES,
  learnerVocabularySchema,
  vocabularyItemSchema,
} from "../src/vocabulary";

const noun = {
  id: "22222222-2222-4222-8222-222222222222",
  lemma: "Zug",
  word: "der Zug",
  partOfSpeech: "noun",
  gender: "der",
  plural: "Züge",
  englishTranslation: "train",
  germanDefinition: "Ein Fahrzeug auf Schienen.",
  example: "Ich fahre mit dem Zug.",
  collocations: ["mit dem Zug fahren"],
  commonMistakes: ["mit der Zug"],
  cefr: "A1",
  miniLevel: 8,
  topic: "travel",
  frequencyBand: 2,
  isCoreWord: true,
} as const;

describe("vocabularyItemSchema", () => {
  it("accepts a fully specified noun", () => {
    expect(vocabularyItemSchema.parse(noun).lemma).toBe("Zug");
  });

  it.each(["der", "die", "das"])("accepts gender %s", (gender) => {
    expect(vocabularyItemSchema.parse({ ...noun, gender }).gender).toBe(gender);
  });

  it("requires a gender on a noun, because German nouns have one", () => {
    expect(
      vocabularyItemSchema.safeParse({ ...noun, gender: null }).success,
    ).toBe(false);
  });

  it("forbids a gender on a verb", () => {
    const verb = {
      ...noun,
      lemma: "fahren",
      word: "fahren",
      partOfSpeech: "verb",
      plural: null,
    };

    expect(vocabularyItemSchema.safeParse(verb).success).toBe(false);
    expect(
      vocabularyItemSchema.safeParse({ ...verb, gender: null }).success,
    ).toBe(true);
  });

  it("rejects a CEFR level inconsistent with its mini-level", () => {
    expect(
      vocabularyItemSchema.safeParse({ ...noun, cefr: "B1", miniLevel: 8 })
        .success,
    ).toBe(false);
  });

  it("rejects an invalid mini-level", () => {
    expect(
      vocabularyItemSchema.safeParse({ ...noun, miniLevel: 99 }).success,
    ).toBe(false);
  });
});

describe("learnerVocabularySchema", () => {
  const progress = {
    learnerId: "11111111-1111-4111-8111-111111111111",
    vocabularyItemId: "22222222-2222-4222-8222-222222222222",
    exposureCount: 12,
    correctCount: 3,
    incorrectCount: 9,
    masteryScore: 0.2,
    confidence: 0.3,
    lastSeenAt: "2026-08-20T10:00:00.000Z",
    nextReviewAt: "2026-08-22T10:00:00.000Z",
    status: "weak",
  };

  it("accepts a valid progress record", () => {
    expect(learnerVocabularySchema.parse(progress).status).toBe("weak");
  });

  it("has the six designed statuses", () => {
    expect(VOCABULARY_STATUSES).toEqual([
      "new",
      "introduced",
      "learning",
      "familiar",
      "mastered",
      "weak",
    ]);
  });

  it("rejects an unknown status", () => {
    expect(
      learnerVocabularySchema.safeParse({ ...progress, status: "known" })
        .success,
    ).toBe(false);
  });

  it.each(["exposureCount", "correctCount", "incorrectCount"])(
    "rejects a negative %s",
    (field) => {
      expect(
        learnerVocabularySchema.safeParse({ ...progress, [field]: -1 }).success,
      ).toBe(false);
    },
  );

  it("rejects more correct and incorrect uses than exposures", () => {
    expect(
      learnerVocabularySchema.safeParse({
        ...progress,
        exposureCount: 2,
        correctCount: 5,
        incorrectCount: 5,
      }).success,
    ).toBe(false);
  });

  it("does not let heavy exposure alone claim mastery", () => {
    // The schema is the guard of last resort: a record cannot simultaneously
    // report mostly-incorrect use and mastered status.
    expect(
      learnerVocabularySchema.safeParse({
        ...progress,
        exposureCount: 50,
        correctCount: 1,
        incorrectCount: 49,
        masteryScore: 0.02,
        status: "mastered",
      }).success,
    ).toBe(false);
  });

  it("allows a new word with no history and no review date", () => {
    expect(
      learnerVocabularySchema.parse({
        ...progress,
        exposureCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        masteryScore: 0,
        confidence: 0,
        lastSeenAt: null,
        nextReviewAt: null,
        status: "new",
      }).lastSeenAt,
    ).toBeNull();
  });
});
