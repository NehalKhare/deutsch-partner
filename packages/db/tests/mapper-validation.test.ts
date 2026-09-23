import { describe, expect, it } from "vitest";
import {
  grammarPatternFromRow,
  learnerVocabularyFromRow,
  vocabularyItemFromRow,
} from "../src/rows";

const vocabRow = {
  id: "22222222-2222-4222-8222-222222222222",
  lemma: "Zug", word: "der Zug", part_of_speech: "verb", gender: "der",
  plural: null, english_translation: "train", german_definition: "x",
  example: "y", collocations: [], common_mistakes: [], cefr: "A1",
  mini_level: 8, topic: "travel", frequency_band: 2, is_core_word: true,
};

describe("mapped rows are checked, not asserted", () => {
  it("refuses a gender on something that is not a noun", () => {
    expect(vocabularyItemFromRow.safeParse(vocabRow).success).toBe(false);
  });

  it("refuses a CEFR band that contradicts the mini-level", () => {
    expect(
      vocabularyItemFromRow.safeParse({ ...vocabRow, part_of_speech: "noun", cefr: "B1" })
        .success,
    ).toBe(false);
  });

  it("refuses a pattern related to itself", () => {
    expect(
      grammarPatternFromRow.safeParse({
        id: "33333333-3333-4333-8333-333333333333",
        key: "perfekt", name: "Perfekt", explanation: "x", examples: ["y"],
        cefr: "A1", mini_level: 13, difficulty: 2, common_mistakes: [],
        related_pattern_keys: ["perfekt"],
      }).success,
    ).toBe(false);
  });

  it("refuses more recorded uses than exposures", () => {
    expect(
      learnerVocabularyFromRow.safeParse({
        learner_id: "11111111-1111-4111-8111-111111111111",
        vocabulary_item_id: "22222222-2222-4222-8222-222222222222",
        exposure_count: 1, correct_count: 5, incorrect_count: 0,
        mastery_score: 0.5, confidence: 0.5, last_seen_at: null,
        next_review_at: null, status: "learning",
      }).success,
    ).toBe(false);
  });

  it("fails rather than throwing on a malformed row", () => {
    expect(() => vocabularyItemFromRow.safeParse(vocabRow)).not.toThrow();
  });
});
