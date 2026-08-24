import { describe, expect, it } from "vitest";

import {
  isMiniLevelComplete,
  masteryCriteriaSchema,
  miniLevelDefinitionSchema,
  miniLevelProgressSchema,
  unmetMasteryCriteria,
  type MiniLevelDefinition,
  type MiniLevelProgress,
} from "@/domain/mini-level";

const definition: MiniLevelDefinition = miniLevelDefinitionSchema.parse({
  miniLevel: 8,
  cefr: "A1",
  theme: "Im Café",
  focus: "ordering food and drink",
  targetVocabulary: ["der Kaffee", "das Wasser", "bestellen", "zahlen"],
  targetGrammar: ["moechten_present", "accusative_case_objects"],
  conversationFunctions: ["order a drink", "ask for the bill"],
  comprehensionGoals: ["Follow a short exchange in a café."],
  productionGoals: ["Order a drink without rehearsing the sentence."],
  masteryCriteria: {
    vocabularyMastered: 3,
    grammarAccuracy: 0.6,
    comprehensionScore: 0.6,
    productiveTurns: 6,
  },
  reviewRequirements: { minReviewItems: 5, maxOverdueItems: 10 },
  recommendedActivities: ["Role-play: order a drink."],
});

/** Progress that clears every criterion, so each test can spoil one field. */
const completed: MiniLevelProgress = {
  vocabularyMastered: 3,
  grammarAccuracy: 0.6,
  comprehensionScore: 0.6,
  productiveTurns: 6,
  reviewItemsCleared: 5,
  overdueReviewItems: 0,
};

describe("mini-level definition", () => {
  it("accepts a definition whose CEFR level matches its mini-level", () => {
    expect(definition.miniLevel).toBe(8);
    expect(definition.cefr).toBe("A1");
  });

  it("rejects a CEFR level that contradicts the mini-level", () => {
    const parsed = miniLevelDefinitionSchema.safeParse({
      ...definition,
      cefr: "B1",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a mini-level outside the curriculum", () => {
    const parsed = miniLevelDefinitionSchema.safeParse({
      ...definition,
      miniLevel: 71,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a level that teaches no vocabulary", () => {
    const parsed = miniLevelDefinitionSchema.safeParse({
      ...definition,
      targetVocabulary: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an unexpected property, which would mean drift", () => {
    const parsed = miniLevelDefinitionSchema.safeParse({
      ...definition,
      difficulty: 3,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an accuracy target outside the unit interval", () => {
    const parsed = masteryCriteriaSchema.safeParse({
      vocabularyMastered: 3,
      grammarAccuracy: 1.2,
      comprehensionScore: 0.6,
      productiveTurns: 6,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a mastery target of zero words, which nobody could fail", () => {
    const parsed = masteryCriteriaSchema.safeParse({
      vocabularyMastered: 0,
      grammarAccuracy: 0.6,
      comprehensionScore: 0.6,
      productiveTurns: 6,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects negative progress", () => {
    const parsed = miniLevelProgressSchema.safeParse({
      ...completed,
      productiveTurns: -1,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("mini-level completion", () => {
  it("is complete when every criterion is met", () => {
    expect(unmetMasteryCriteria(definition, completed)).toEqual([]);
    expect(isMiniLevelComplete(definition, completed)).toBe(true);
  });

  it("counts a value exactly on the threshold as met", () => {
    // 0.1 + 0.2 is not 0.3 in binary floating point. A learner who has done
    // exactly what was asked must not be held back by that.
    const onThreshold = { ...completed, grammarAccuracy: 0.1 + 0.2 + 0.3 };

    expect(isMiniLevelComplete(definition, onThreshold)).toBe(true);
  });

  it("names the vocabulary shortfall rather than only failing", () => {
    const unmet = unmetMasteryCriteria(definition, {
      ...completed,
      vocabularyMastered: 1,
    });

    expect(unmet).toEqual([
      {
        criterion: "vocabularyMastered",
        direction: "at_least",
        required: 3,
        actual: 1,
      },
    ]);
  });

  it("reports every unmet criterion, not just the first", () => {
    const unmet = unmetMasteryCriteria(definition, {
      ...completed,
      vocabularyMastered: 0,
      grammarAccuracy: 0,
      comprehensionScore: 0,
      productiveTurns: 0,
      reviewItemsCleared: 0,
    });

    expect(unmet.map((entry) => entry.criterion)).toEqual([
      "vocabularyMastered",
      "grammarAccuracy",
      "comprehensionScore",
      "productiveTurns",
      "reviewItemsCleared",
    ]);
  });

  it("treats overdue review items as a ceiling, not a target", () => {
    const unmet = unmetMasteryCriteria(definition, {
      ...completed,
      overdueReviewItems: 11,
    });

    expect(unmet).toEqual([
      {
        criterion: "overdueReviewItems",
        direction: "at_most",
        required: 10,
        actual: 11,
      },
    ]);
    expect(isMiniLevelComplete(definition, { ...completed, overdueReviewItems: 11 })).toBe(false);
  });

  it("lets a backlog exactly at the ceiling through", () => {
    expect(
      isMiniLevelComplete(definition, { ...completed, overdueReviewItems: 10 }),
    ).toBe(true);
  });

  it("rejects malformed progress rather than guessing", () => {
    expect(() =>
      isMiniLevelComplete(definition, { vocabularyMastered: 3 } as never),
    ).toThrow();
  });
});
