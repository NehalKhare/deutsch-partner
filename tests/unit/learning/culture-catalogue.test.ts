import { describe, expect, it } from "vitest";

import { cefrForMiniLevel } from "@/domain/cefr";
import { grammarPatternSchema } from "@/domain/grammar";
import { CURRICULUM_ENTRIES } from "@/learning/curriculum";
import { CULTURE_CATALOGUE } from "@/learning/culture-catalogue";
import { CULTURE_LABELS } from "@/learning/culture-labels";
import { CULTURE_SEEDS } from "@/learning/culture-seeds";
import { ERROR_TYPE_LABELS } from "@/learning/error-labels";
import { GRAMMAR_CATALOGUE } from "@/learning/grammar-catalogue";
import { GRAMMAR_SEEDS } from "@/learning/grammar-seeds";

/**
 * The culture catalogue, held to the grammar catalogue's standard — plus the
 * constraints that come from sharing its table and its subject namespace: a
 * key clash aborts the seed on the unique constraint, and a name that
 * collides with a grammar pattern's or a mistake label's would corrupt the
 * subject-keyed maps a trainer session runs on.
 */

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";
const taughtKeys = new Set(
  CURRICULUM_ENTRIES.flatMap((entry) => entry.culture ?? []),
);

describe("the culture seeds", () => {
  it("explain every note the curriculum teaches", () => {
    const explained = new Set(CULTURE_SEEDS.map((seed) => seed.key));
    const missing = [...taughtKeys].filter((key) => !explained.has(key));

    expect(missing).toEqual([]);
  });

  it("explain no note the curriculum never teaches", () => {
    const orphans = CULTURE_SEEDS.filter((seed) => !taughtKeys.has(seed.key));

    expect(orphans.map((seed) => seed.key)).toEqual([]);
  });

  it("carry a label for every key, in both directions", () => {
    const seeded = new Set(CULTURE_SEEDS.map((seed) => seed.key));

    expect(
      CULTURE_SEEDS.filter((seed) => !(seed.key in CULTURE_LABELS)).map((s) => s.key),
    ).toEqual([]);
    expect(Object.keys(CULTURE_LABELS).filter((key) => !seeded.has(key))).toEqual([]);
  });

  it("define each key once, and never a key the grammar seeds own", () => {
    const keys = CULTURE_SEEDS.map((seed) => seed.key);
    const grammarKeys = new Set(GRAMMAR_SEEDS.map((seed) => seed.key));

    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
    // Same table, unique key column: a clash aborts the whole seed.
    expect(keys.filter((key) => grammarKeys.has(key))).toEqual([]);
  });

  it("give every note at least one example and one named misstep", () => {
    for (const seed of CULTURE_SEEDS) {
      expect(seed.examples.length, seed.key).toBeGreaterThan(0);
      expect(seed.mistakes.length, seed.key).toBeGreaterThan(0);
    }
  });

  it("write every misstep as a wrong form and then a right one", () => {
    const malformed = CULTURE_SEEDS.filter((seed) =>
      seed.mistakes.some((mistake) => !mistake.startsWith("*") || !mistake.includes("→")),
    );

    expect(malformed.map((seed) => seed.key)).toEqual([]);
  });

  it("point only at patterns or notes that exist", () => {
    // Culture notes may lean on grammar — the du/Sie note points at the
    // pronouns — so the known set spans both catalogues.
    const known = new Set([
      ...CULTURE_SEEDS.map((seed) => seed.key),
      ...GRAMMAR_SEEDS.map((seed) => seed.key),
    ]);
    const dangling = CULTURE_SEEDS.flatMap((seed) =>
      seed.related.filter((related) => !known.has(related)),
    );

    expect([...new Set(dangling)]).toEqual([]);
  });

  it("never point at themselves, which the database refuses", () => {
    const selfReferencing = CULTURE_SEEDS.filter((seed) =>
      seed.related.includes(seed.key),
    );

    expect(selfReferencing.map((seed) => seed.key)).toEqual([]);
  });

  it("use no double quote, which the generated SQL cannot carry", () => {
    const offenders = CULTURE_SEEDS.filter((seed) =>
      [seed.explanation, ...seed.examples, ...seed.mistakes].some((text) =>
        text.includes('"'),
      ),
    );

    expect(offenders.map((seed) => seed.key)).toEqual([]);
  });
});

describe("the culture catalogue", () => {
  it("holds one row per note, every one marked culture", () => {
    expect(CULTURE_CATALOGUE).toHaveLength(CULTURE_SEEDS.length);
    for (const note of CULTURE_CATALOGUE) {
      expect(note.category, note.key).toBe("culture");
    }
  });

  it("holds only rows the domain schema accepts", () => {
    for (const note of CULTURE_CATALOGUE) {
      const parsed = grammarPatternSchema.safeParse({
        ...note,
        id: PLACEHOLDER_ID,
      });

      expect(parsed.success, `${note.key} is malformed`).toBe(true);
    }
  });

  it("teaches each note at the first level that targets it", () => {
    for (const note of CULTURE_CATALOGUE) {
      const firstLevel =
        CURRICULUM_ENTRIES.findIndex((entry) =>
          (entry.culture ?? []).includes(note.key),
        ) + 1;

      expect(note.miniLevel, note.key).toBe(firstLevel);
      expect(note.cefr, note.key).toBe(cefrForMiniLevel(firstLevel));
    }
  });

  it("starts every name with a capital and no leading article", () => {
    for (const note of CULTURE_CATALOGUE) {
      expect(note.name, note.key).not.toMatch(/^the /i);
      expect(note.name[0], note.key).toBe(note.name[0].toUpperCase());
    }
  });

  it("names nothing a grammar pattern or a mistake label already claims", () => {
    // Agenda subjects key the session's covered set and the drill-close map;
    // two rows answering to one name would close each other's items.
    const grammarNames = new Set(GRAMMAR_CATALOGUE.map((pattern) => pattern.name));
    const errorLabels = new Set(Object.values(ERROR_TYPE_LABELS));

    for (const note of CULTURE_CATALOGUE) {
      expect(grammarNames.has(note.name), note.key).toBe(false);
      expect(errorLabels.has(note.name), note.key).toBe(false);
    }
  });

  it("keeps difficulty inside the range the database allows", () => {
    for (const note of CULTURE_CATALOGUE) {
      expect(note.difficulty, note.key).toBeGreaterThanOrEqual(1);
      expect(note.difficulty, note.key).toBeLessThanOrEqual(5);
    }
  });

  it("spreads across all three bands, one note per level at most", () => {
    const bands = new Set(CULTURE_CATALOGUE.map((note) => note.cefr));
    const levels = CULTURE_CATALOGUE.map((note) => note.miniLevel);

    expect([...bands].sort()).toEqual(["A1", "A2", "B1"]);
    expect(levels.filter((level, index) => levels.indexOf(level) !== index)).toEqual([]);
  });
});
