import { describe, expect, it } from "vitest";
import { grammarPatternSchema } from "../src/grammar";

const pattern = {
  id: "44444444-4444-4444-8444-444444444444",
  key: "dative_after_mit",
  name: "Dative after mit",
  explanation: "The preposition mit always takes the dative case.",
  examples: ["Ich fahre mit dem Zug.", "Sie spricht mit der Lehrerin."],
  cefr: "A2",
  miniLevel: 22,
  difficulty: 3,
  commonMistakes: ["mit der Zug"],
  relatedPatternKeys: ["case_dative"],
  category: "grammar",
};

describe("grammarPatternSchema", () => {
  it("accepts a valid pattern", () => {
    expect(grammarPatternSchema.parse(pattern).key).toBe("dative_after_mit");
  });

  it("accepts a culture note and keeps the category pair closed", () => {
    expect(
      grammarPatternSchema.safeParse({ ...pattern, category: "culture" }).success,
    ).toBe(true);
    expect(
      grammarPatternSchema.safeParse({ ...pattern, category: "vibes" }).success,
    ).toBe(false);
  });

  it("requires at least one example, since a rule without one cannot be taught", () => {
    expect(
      grammarPatternSchema.safeParse({ ...pattern, examples: [] }).success,
    ).toBe(false);
  });

  it("requires a snake_case key so keys stay stable and referenceable", () => {
    expect(
      grammarPatternSchema.safeParse({ ...pattern, key: "Dative After Mit" })
        .success,
    ).toBe(false);
  });

  it.each([0, 6])("rejects difficulty %i outside the one-to-five scale", (difficulty) => {
    expect(
      grammarPatternSchema.safeParse({ ...pattern, difficulty }).success,
    ).toBe(false);
  });

  it("rejects a CEFR level inconsistent with its mini-level", () => {
    expect(
      grammarPatternSchema.safeParse({ ...pattern, cefr: "A1" }).success,
    ).toBe(false);
  });

  it("does not let a pattern relate to itself", () => {
    expect(
      grammarPatternSchema.safeParse({
        ...pattern,
        relatedPatternKeys: ["dative_after_mit"],
      }).success,
    ).toBe(false);
  });
});
