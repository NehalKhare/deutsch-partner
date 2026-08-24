import { describe, expect, it } from "vitest";
import { RETRIEVAL_INTENTS, retrievalContextSchema } from "@/domain/retrieval";

const context = {
  intent: "grammar",
  cefr: "A2",
  miniLevel: 22,
  topic: "travel",
  weakGrammarKeys: ["dative_after_mit"],
  recurringErrorTypes: ["case_dative"],
  targetVocabularyLemmas: ["Zug", "fahren"],
  currentLessonTarget: "dative after prepositions",
};

describe("retrievalContextSchema", () => {
  it("accepts a learner-aware retrieval context", () => {
    expect(retrievalContextSchema.parse(context).intent).toBe("grammar");
  });

  it("routes across the designed intents", () => {
    expect(RETRIEVAL_INTENTS).toEqual(
      expect.arrayContaining([
        "vocabulary",
        "grammar",
        "conversation",
        "culture",
        "web",
      ]),
    );
  });

  it("rejects an unknown intent", () => {
    expect(
      retrievalContextSchema.safeParse({ ...context, intent: "vibes" }).success,
    ).toBe(false);
  });

  it("requires the level, because retrieval is always level-filtered", () => {
    const { cefr, ...withoutLevel } = context;

    expect(retrievalContextSchema.safeParse(withoutLevel).success).toBe(false);
    expect(cefr).toBe("A2");
  });

  it("defaults the optional learner signals to empty lists", () => {
    const parsed = retrievalContextSchema.parse({
      intent: "conversation",
      cefr: "A1",
      miniLevel: 3,
    });

    expect(parsed.weakGrammarKeys).toEqual([]);
    expect(parsed.recurringErrorTypes).toEqual([]);
    expect(parsed.targetVocabularyLemmas).toEqual([]);
  });

  it("rejects a mini-level inconsistent with the CEFR level", () => {
    expect(
      retrievalContextSchema.safeParse({ ...context, cefr: "A1" }).success,
    ).toBe(false);
  });

  it("caps the target vocabulary list so a context cannot grow unbounded", () => {
    expect(
      retrievalContextSchema.safeParse({
        ...context,
        targetVocabularyLemmas: Array.from({ length: 200 }, (_, i) => `w${i}`),
      }).success,
    ).toBe(false);
  });
});
