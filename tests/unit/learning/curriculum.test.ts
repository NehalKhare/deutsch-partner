import { describe, expect, it } from "vitest";

import { MAX_MINI_LEVEL, cefrForMiniLevel } from "@/domain/cefr";
import { miniLevelDefinitionSchema } from "@/domain/mini-level";
import { GRAMMAR_LABELS } from "@/learning/grammar-labels";
import {
  MINI_LEVEL_CURRICULUM,
  findMiniLevel,
  getCurrentMiniLevel,
  getMiniLevel,
  getNextMiniLevel,
} from "@/learning/mini-levels";

describe("the curriculum", () => {
  it("covers every mini-level on the path, in order and without gaps", () => {
    expect(MINI_LEVEL_CURRICULUM).toHaveLength(MAX_MINI_LEVEL);
    expect(MINI_LEVEL_CURRICULUM.map((level) => level.miniLevel)).toEqual(
      Array.from({ length: MAX_MINI_LEVEL }, (_, index) => index + 1),
    );
  });

  it("holds only definitions that satisfy the domain schema", () => {
    for (const level of MINI_LEVEL_CURRICULUM) {
      const parsed = miniLevelDefinitionSchema.safeParse(level);

      expect(parsed.success, `mini-level ${level.miniLevel} is malformed`).toBe(
        true,
      );
    }
  });

  it("places every level in the CEFR band its number belongs to", () => {
    for (const level of MINI_LEVEL_CURRICULUM) {
      expect(level.cefr).toBe(cefrForMiniLevel(level.miniLevel));
    }
  });

  it("gives every level a distinct theme, so progress is visible", () => {
    const themes = MINI_LEVEL_CURRICULUM.map((level) => level.theme);

    expect(new Set(themes).size).toBe(themes.length);
  });

  it("never asks a learner to master more words than the level teaches", () => {
    for (const level of MINI_LEVEL_CURRICULUM) {
      expect(
        level.masteryCriteria.vocabularyMastered,
        `mini-level ${level.miniLevel} is unpassable`,
      ).toBeLessThanOrEqual(level.targetVocabulary.length);
    }
  });

  it("names a known grammar pattern in every target", () => {
    // The slugs are the join key to grammar_patterns.key. A slug with no
    // label is one nothing can explain to a learner.
    const unlabelled = MINI_LEVEL_CURRICULUM.flatMap((level) =>
      level.targetGrammar.filter((slug) => !(slug in GRAMMAR_LABELS)),
    );

    expect([...new Set(unlabelled)]).toEqual([]);
  });

  it("uses slugs, not prose, as grammar keys", () => {
    const slugs = MINI_LEVEL_CURRICULUM.flatMap((level) => level.targetGrammar);

    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("labels no grammar pattern the curriculum never teaches", () => {
    const used = new Set(
      MINI_LEVEL_CURRICULUM.flatMap((level) => level.targetGrammar),
    );

    expect(Object.keys(GRAMMAR_LABELS).filter((key) => !used.has(key))).toEqual(
      [],
    );
  });

  it("raises its demands as the learner climbs", () => {
    const a1 = MINI_LEVEL_CURRICULUM[0];
    const b1 = MINI_LEVEL_CURRICULUM[MAX_MINI_LEVEL - 1];

    expect(b1.masteryCriteria.grammarAccuracy).toBeGreaterThan(
      a1.masteryCriteria.grammarAccuracy,
    );
    expect(b1.masteryCriteria.productiveTurns).toBeGreaterThan(
      a1.masteryCriteria.productiveTurns,
    );
  });

  it("writes goals about the level itself, not boilerplate", () => {
    for (const level of MINI_LEVEL_CURRICULUM) {
      expect(level.comprehensionGoals.join(" ")).toContain(level.focus);
      expect(level.productionGoals.length).toBeGreaterThan(0);
      expect(level.recommendedActivities.join(" ")).toContain(level.focus);
    }
  });
});

describe("looking a mini-level up", () => {
  it("returns the definition for a level on the path", () => {
    expect(getMiniLevel(1).miniLevel).toBe(1);
    expect(getMiniLevel(70).cefr).toBe("B1");
  });

  it("refuses a level that is not on the path", () => {
    expect(() => getMiniLevel(0)).toThrow();
    expect(() => getMiniLevel(71)).toThrow();
    expect(() => getMiniLevel(7.5)).toThrow();
  });

  it("answers with null rather than throwing when asked to look", () => {
    expect(findMiniLevel(71)).toBeNull();
    expect(findMiniLevel("nonsense")).toBeNull();
    expect(findMiniLevel(1)?.miniLevel).toBe(1);
  });

  it("reads the current level off the learner's state", () => {
    expect(getCurrentMiniLevel({ miniLevel: 22 }).miniLevel).toBe(22);
    expect(getCurrentMiniLevel({ miniLevel: 22 }).cefr).toBe("A2");
  });
});

describe("advancing to the next mini-level", () => {
  it("crosses from A1 into A2 at the band boundary", () => {
    const next = getNextMiniLevel(15);

    expect(next?.miniLevel).toBe(16);
    expect(next?.cefr).toBe("A2");
  });

  it("crosses from A2 into B1 at the band boundary", () => {
    const next = getNextMiniLevel(35);

    expect(next?.miniLevel).toBe(36);
    expect(next?.cefr).toBe("B1");
  });

  it("stops at the top of the path", () => {
    // B1 is where the product stops. There is no mini-level 71 to promise.
    expect(getNextMiniLevel(70)).toBeNull();
  });

  it("stays inside its own band elsewhere", () => {
    expect(getNextMiniLevel(14)).toMatchObject({ miniLevel: 15, cefr: "A1" });
  });

  it("refuses a level that is not on the path", () => {
    expect(() => getNextMiniLevel(0)).toThrow();
  });
});
