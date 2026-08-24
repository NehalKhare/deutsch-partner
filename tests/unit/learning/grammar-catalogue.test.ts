import { describe, expect, it } from "vitest";

import { cefrForMiniLevel } from "@/domain/cefr";
import { grammarPatternSchema } from "@/domain/grammar";
import { CURRICULUM_ENTRIES } from "@/learning/curriculum";
import { GRAMMAR_CATALOGUE } from "@/learning/grammar-catalogue";
import { GRAMMAR_LABELS } from "@/learning/grammar-labels";
import { GRAMMAR_SEEDS } from "@/learning/grammar-seeds";

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";
const taughtKeys = new Set(CURRICULUM_ENTRIES.flatMap((entry) => entry.grammar));

describe("the grammar seeds", () => {
  it("explain every pattern the curriculum teaches", () => {
    const explained = new Set(GRAMMAR_SEEDS.map((seed) => seed.key));
    const missing = [...taughtKeys].filter((key) => !explained.has(key));

    expect(missing).toEqual([]);
  });

  it("explain no pattern the curriculum never teaches", () => {
    const orphans = GRAMMAR_SEEDS.filter((seed) => !taughtKeys.has(seed.key));

    expect(orphans.map((seed) => seed.key)).toEqual([]);
  });

  it("carry a label for every key, in both directions", () => {
    const seeded = new Set(GRAMMAR_SEEDS.map((seed) => seed.key));

    expect(
      GRAMMAR_SEEDS.filter((seed) => !(seed.key in GRAMMAR_LABELS)).map((s) => s.key),
    ).toEqual([]);
    expect(Object.keys(GRAMMAR_LABELS).filter((key) => !seeded.has(key))).toEqual([]);
  });

  it("define each key once", () => {
    const keys = GRAMMAR_SEEDS.map((seed) => seed.key);

    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it("give every pattern at least one example and one named mistake", () => {
    // The mistakes are the point. A pattern with an explanation but nothing to
    // correct against gives the tutor nothing to say when a learner gets it
    // wrong.
    for (const seed of GRAMMAR_SEEDS) {
      expect(seed.examples.length, seed.key).toBeGreaterThan(0);
      expect(seed.mistakes.length, seed.key).toBeGreaterThan(0);
    }
  });

  it("write every mistake as a wrong form and then a right one", () => {
    const malformed = GRAMMAR_SEEDS.filter((seed) =>
      seed.mistakes.some((mistake) => !mistake.startsWith("*") || !mistake.includes("→")),
    );

    expect(malformed.map((seed) => seed.key)).toEqual([]);
  });

  it("point only at patterns that exist", () => {
    const known = new Set(GRAMMAR_SEEDS.map((seed) => seed.key));
    const dangling = GRAMMAR_SEEDS.flatMap((seed) =>
      seed.related.filter((related) => !known.has(related)),
    );

    expect([...new Set(dangling)]).toEqual([]);
  });

  it("never point at themselves, which the database refuses", () => {
    const selfReferencing = GRAMMAR_SEEDS.filter((seed) =>
      seed.related.includes(seed.key),
    );

    expect(selfReferencing.map((seed) => seed.key)).toEqual([]);
  });

  it("use no double quote, which the generated SQL cannot carry", () => {
    const offenders = GRAMMAR_SEEDS.filter((seed) =>
      [seed.explanation, ...seed.examples, ...seed.mistakes].some((text) =>
        text.includes('"'),
      ),
    );

    expect(offenders.map((seed) => seed.key)).toEqual([]);
  });
});

describe("the grammar catalogue", () => {
  it("holds one row per pattern", () => {
    expect(GRAMMAR_CATALOGUE).toHaveLength(GRAMMAR_SEEDS.length);
  });

  it("holds only rows the domain schema accepts", () => {
    for (const pattern of GRAMMAR_CATALOGUE) {
      const parsed = grammarPatternSchema.safeParse({
        ...pattern,
        id: PLACEHOLDER_ID,
      });

      expect(parsed.success, `${pattern.key} is malformed`).toBe(true);
    }
  });

  it("teaches each pattern at the first level that targets it", () => {
    for (const pattern of GRAMMAR_CATALOGUE) {
      const firstLevel =
        CURRICULUM_ENTRIES.findIndex((entry) => entry.grammar.includes(pattern.key)) + 1;

      expect(pattern.miniLevel, pattern.key).toBe(firstLevel);
      expect(pattern.cefr, pattern.key).toBe(cefrForMiniLevel(firstLevel));
    }
  });

  it("names a pattern so it can stand on its own", () => {
    const pattern = GRAMMAR_CATALOGUE.find((entry) => entry.key === "perfekt_with_sein");

    expect(pattern?.name).toBe("Perfekt with sein");
  });

  it("starts every name with a capital and no leading article", () => {
    for (const pattern of GRAMMAR_CATALOGUE) {
      expect(pattern.name, pattern.key).not.toMatch(/^the /i);
      expect(pattern.name[0], pattern.key).toBe(pattern.name[0].toUpperCase());
    }
  });

  it("keeps difficulty inside the range the database allows", () => {
    for (const pattern of GRAMMAR_CATALOGUE) {
      expect(pattern.difficulty, pattern.key).toBeGreaterThanOrEqual(1);
      expect(pattern.difficulty, pattern.key).toBeLessThanOrEqual(5);
    }
  });

  it("lets a pattern be marked harder than its position suggests", () => {
    // Two-way prepositions arrive at mini-level 12 but defeat learners for
    // years. Deriving difficulty from the level alone would call them easy.
    const twoWay = GRAMMAR_CATALOGUE.find(
      (pattern) => pattern.key === "two_way_prepositions_static",
    );

    expect(twoWay?.miniLevel).toBeLessThan(15);
    expect(twoWay?.difficulty).toBe(3);
  });

  it("gets harder as the path goes on", () => {
    const early = GRAMMAR_CATALOGUE.filter((p) => p.cefr === "A1");
    const late = GRAMMAR_CATALOGUE.filter((p) => p.cefr === "B1");
    const mean = (list: readonly { difficulty: number }[]) =>
      list.reduce((total, p) => total + p.difficulty, 0) / list.length;

    expect(mean(late)).toBeGreaterThan(mean(early));
  });
});
