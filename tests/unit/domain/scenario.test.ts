import { describe, expect, it } from "vitest";

import {
  MAX_SCENARIO_QUERY_LENGTH,
  scenarioSchema,
  scenarioSummarySchema,
} from "@/domain/scenario";

/**
 * The scenario model.
 *
 * A scenario is one of exactly two things — a dialogue to roleplay or a
 * comprehension to read and answer — and the schema is where that fact is
 * enforced. Everything downstream (the repository, the API, the cards)
 * trusts the discriminated union instead of re-checking.
 */

const DIALOGUE = {
  id: 1,
  slug: "dialogue-a1-im-restaurant",
  type: "dialogue",
  kind: "dialogue",
  title: "Im Restaurant",
  titleEnglish: "At the Restaurant",
  description: "A customer orders lunch.",
  targetLevel: "A1",
  source: "Conversational_German_15_Dialogue_Stories.md",
  itemIndex: 0,
  content: {
    setting: "A small German restaurant.",
    lines: [{ speaker: "Anna", german: "Guten Tag!", english: "Hello!" }],
  },
  vocabulary: [{ term: "die Suppe", meaning: "soup" }],
};

const COMPREHENSION = {
  id: 2,
  slug: "comprehension-a1-reading-ein-neuer-morgen",
  type: "comprehension",
  kind: "reading",
  title: "Ein neuer Morgen",
  titleEnglish: "A New Morning",
  description: "A German reading passage.",
  targetLevel: "A1",
  source: "German_Listening_and_Comprehension_Practice.md",
  itemIndex: 20,
  content: {
    passage: "Anna steht jeden Morgen um sieben Uhr auf.",
    passageEnglish: null,
    questions: [{ question: "Wann steht Anna auf?", answer: "Um sieben Uhr." }],
  },
  vocabulary: [],
};

describe("the scenario schema", () => {
  it("accepts a dialogue", () => {
    const parsed = scenarioSchema.safeParse(DIALOGUE);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "dialogue") {
      expect(parsed.data.content.lines[0].speaker).toBe("Anna");
    }
  });

  it("accepts a comprehension", () => {
    const parsed = scenarioSchema.safeParse(COMPREHENSION);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "comprehension") {
      expect(parsed.data.content.questions).toHaveLength(1);
    }
  });

  it("rejects a type outside the two the product knows", () => {
    expect(scenarioSchema.safeParse({ ...DIALOGUE, type: "quiz" }).success).toBe(false);
  });

  it("rejects a level outside the corpus band", () => {
    expect(
      scenarioSchema.safeParse({ ...DIALOGUE, targetLevel: "C2" }).success,
    ).toBe(false);
  });

  it("rejects a dialogue whose body is a comprehension's", () => {
    expect(
      scenarioSchema.safeParse({ ...DIALOGUE, content: COMPREHENSION.content }).success,
    ).toBe(false);
  });

  it("rejects a dialogue with no lines", () => {
    expect(
      scenarioSchema.safeParse({
        ...DIALOGUE,
        content: { setting: "x", lines: [] },
      }).success,
    ).toBe(false);
  });

  it("rejects a comprehension with no questions", () => {
    expect(
      scenarioSchema.safeParse({
        ...COMPREHENSION,
        content: { ...COMPREHENSION.content, questions: [] },
      }).success,
    ).toBe(false);
  });

  it("rejects a scenario that cannot cite where it came from", () => {
    const { source: _source, ...uncited } = DIALOGUE;
    expect(scenarioSchema.safeParse(uncited).success).toBe(false);
  });
});

describe("the scenario summary", () => {
  const SUMMARY = {
    id: 1,
    slug: "dialogue-a1-im-restaurant",
    type: "dialogue",
    kind: "dialogue",
    title: "Im Restaurant",
    titleEnglish: "At the Restaurant",
    description: "A customer orders lunch.",
    targetLevel: "A1",
    source: "Conversational_German_15_Dialogue_Stories.md",
    itemIndex: 0,
  };

  it("rejects a card without its citation", () => {
    const { source: _source, ...uncited } = SUMMARY;
    expect(scenarioSummarySchema.safeParse(uncited).success).toBe(false);
  });

  it("accepts a card without a similarity", () => {
    expect(scenarioSummarySchema.safeParse(SUMMARY).success).toBe(true);
  });

  it("accepts a search hit with a similarity in the unit interval", () => {
    expect(
      scenarioSummarySchema.safeParse({ ...SUMMARY, similarity: 0.87 }).success,
    ).toBe(true);
  });

  it("rejects a similarity outside the unit interval", () => {
    expect(
      scenarioSummarySchema.safeParse({ ...SUMMARY, similarity: 1.2 }).success,
    ).toBe(false);
  });
});

describe("the query ceiling", () => {
  it("is small: a search box, not an essay", () => {
    expect(MAX_SCENARIO_QUERY_LENGTH).toBeLessThanOrEqual(300);
    expect(MAX_SCENARIO_QUERY_LENGTH).toBeGreaterThanOrEqual(80);
  });
});
