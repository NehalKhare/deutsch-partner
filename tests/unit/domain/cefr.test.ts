import { describe, expect, it } from "vitest";
import {
  CEFR_LEVELS,
  MAX_MINI_LEVEL,
  MIN_MINI_LEVEL,
  cefrLevelSchema,
  cefrForMiniLevel,
  effectiveLevelSchema,
  formatEffectiveLevel,
  miniLevelSchema,
  miniLevelRangeFor,
  nextMiniLevel,
} from "@/domain/cefr";

describe("cefrLevelSchema", () => {
  it.each(CEFR_LEVELS)("accepts %s", (level) => {
    expect(cefrLevelSchema.parse(level)).toBe(level);
  });

  it.each(["A0", "B2", "C1", "a1", "", "B1 "])("rejects %o", (value) => {
    expect(cefrLevelSchema.safeParse(value).success).toBe(false);
  });

  it("stops at B1, which is the product's stated ceiling", () => {
    expect(CEFR_LEVELS).toEqual(["A1", "A2", "B1"]);
  });
});

describe("miniLevelSchema", () => {
  it.each([MIN_MINI_LEVEL, 15, 16, 35, 36, MAX_MINI_LEVEL])(
    "accepts %i",
    (value) => {
      expect(miniLevelSchema.parse(value)).toBe(value);
    },
  );

  it.each([0, -1, 71, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %o",
    (value) => {
      expect(miniLevelSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects a numeric string, so a query parameter cannot slip through", () => {
    expect(miniLevelSchema.safeParse("12").success).toBe(false);
  });
});

describe("cefrForMiniLevel", () => {
  it.each([
    [1, "A1"],
    [15, "A1"],
    [16, "A2"],
    [35, "A2"],
    [36, "B1"],
    [70, "B1"],
  ])("maps mini-level %i to %s", (miniLevel, expected) => {
    expect(cefrForMiniLevel(miniLevel)).toBe(expected);
  });

  it("rejects a mini-level outside the curriculum", () => {
    expect(() => cefrForMiniLevel(71)).toThrow();
  });
});

describe("miniLevelRangeFor", () => {
  it.each([
    ["A1", 1, 15],
    ["A2", 16, 35],
    ["B1", 36, 70],
  ] as const)("covers %s from %i to %i", (level, first, last) => {
    expect(miniLevelRangeFor(level)).toEqual({ first, last });
  });

  it("covers every mini-level exactly once across the three levels", () => {
    const covered = CEFR_LEVELS.flatMap((level) => {
      const { first, last } = miniLevelRangeFor(level);
      return Array.from({ length: last - first + 1 }, (_, i) => first + i);
    });

    expect(covered).toHaveLength(MAX_MINI_LEVEL);
    expect(new Set(covered).size).toBe(MAX_MINI_LEVEL);
  });
});

describe("nextMiniLevel", () => {
  it("crosses from A1 into A2", () => {
    expect(nextMiniLevel(15)).toEqual({ miniLevel: 16, cefr: "A2" });
  });

  it("crosses from A2 into B1", () => {
    expect(nextMiniLevel(35)).toEqual({ miniLevel: 36, cefr: "B1" });
  });

  it("has nothing after the final mini-level", () => {
    expect(nextMiniLevel(70)).toBeNull();
  });
});

describe("effectiveLevel", () => {
  it("represents a level with a plus modifier", () => {
    const level = effectiveLevelSchema.parse({ cefr: "A2", plus: true });

    expect(formatEffectiveLevel(level)).toBe("A2+");
  });

  it("formats a plain level without a modifier", () => {
    expect(formatEffectiveLevel({ cefr: "A2", plus: false })).toBe("A2");
  });

  it("rejects a plus on the highest level, which would imply B2", () => {
    expect(effectiveLevelSchema.safeParse({ cefr: "B1", plus: true }).success)
      .toBe(false);
  });
});
