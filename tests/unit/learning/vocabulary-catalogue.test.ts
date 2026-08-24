import { describe, expect, it } from "vitest";

import { cefrForMiniLevel } from "@/domain/cefr";
import { vocabularyItemSchema } from "@/domain/vocabulary";
import { CURRICULUM_ENTRIES } from "@/learning/curriculum";
import { VOCABULARY_CATALOGUE } from "@/learning/vocabulary-catalogue";
import { TOPIC_OPTIONS } from "@/lib/onboarding/defaults";

/**
 * The catalogue refuses to exist if a target word has no lexicon entry, so
 * importing it here is itself part of the check. The coverage tests that name
 * the missing word live in lexicon.test.ts, which does not import this.
 */

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";
const curriculumWords = CURRICULUM_ENTRIES.flatMap((entry) => entry.vocabulary);

describe("the catalogue", () => {
  it("holds one row per target word", () => {
    expect(VOCABULARY_CATALOGUE).toHaveLength(curriculumWords.length);
  });

  it("holds only rows the domain schema accepts", () => {
    for (const item of VOCABULARY_CATALOGUE) {
      const parsed = vocabularyItemSchema.safeParse({
        ...item,
        id: PLACEHOLDER_ID,
      });

      expect(parsed.success, `${item.word} is malformed`).toBe(true);
    }
  });

  it("places each word at the level that introduces it", () => {
    for (const [index, entry] of CURRICULUM_ENTRIES.entries()) {
      for (const word of entry.vocabulary) {
        const item = VOCABULARY_CATALOGUE.find(
          (candidate) => candidate.word === word,
        );

        expect(item?.miniLevel, word).toBe(index + 1);
        expect(item?.cefr, word).toBe(cefrForMiniLevel(index + 1));
      }
    }
  });

  it("tags every word with a topic the onboarding form offers", () => {
    // These become retrieval filters: a learner who asked for travel and food
    // can only be given words from those levels if the two vocabularies match.
    const offered = new Set(TOPIC_OPTIONS.map((option) => option.value));
    const unknown = VOCABULARY_CATALOGUE.filter(
      (item) => !offered.has(item.topic),
    );

    expect([...new Set(unknown.map((item) => item.topic))]).toEqual([]);
  });

  it("treats words introduced earlier as more frequent", () => {
    const bands = VOCABULARY_CATALOGUE.map((item) => item.frequencyBand);

    expect(Math.min(...bands)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...bands)).toBeLessThanOrEqual(10);
    expect(bands.every((band, index) => index === 0 || band >= bands[index - 1])).toBe(
      true,
    );
  });

  it("counts the A1 and A2 words as core, and no others", () => {
    for (const item of VOCABULARY_CATALOGUE) {
      expect(item.isCoreWord, item.word).toBe(item.cefr !== "B1");
    }
  });

  it("covers every mini-level, so no level is left without words", () => {
    const levels = new Set(VOCABULARY_CATALOGUE.map((item) => item.miniLevel));

    expect(levels.size).toBe(CURRICULUM_ENTRIES.length);
  });
});
