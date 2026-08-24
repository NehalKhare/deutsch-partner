import { z } from "zod";

/**
 * The level model.
 *
 * The product path stops at B1, and the 70 mini-levels partition that path.
 * Both facts are encoded here so no other module has to restate them.
 */

export const CEFR_LEVELS = ["A1", "A2", "B1"] as const;

export const cefrLevelSchema = z.enum(CEFR_LEVELS);
export type CEFRLevel = z.infer<typeof cefrLevelSchema>;

export const MIN_MINI_LEVEL = 1;
export const MAX_MINI_LEVEL = 70;

export const miniLevelSchema = z
  .number()
  .int()
  .min(MIN_MINI_LEVEL)
  .max(MAX_MINI_LEVEL);
export type MiniLevel = z.infer<typeof miniLevelSchema>;

export interface MiniLevelRange {
  readonly first: MiniLevel;
  readonly last: MiniLevel;
}

const MINI_LEVEL_RANGES: Readonly<Record<CEFRLevel, MiniLevelRange>> = {
  A1: { first: 1, last: 15 },
  A2: { first: 16, last: 35 },
  B1: { first: 36, last: 70 },
};

export function miniLevelRangeFor(level: CEFRLevel): MiniLevelRange {
  return MINI_LEVEL_RANGES[level];
}

export function cefrForMiniLevel(miniLevel: number): CEFRLevel {
  const parsed = miniLevelSchema.parse(miniLevel);

  const match = CEFR_LEVELS.find((level) => {
    const { first, last } = MINI_LEVEL_RANGES[level];
    return parsed >= first && parsed <= last;
  });

  // Unreachable while the ranges partition the full path; the invariant is
  // covered by a test rather than left to trust.
  if (!match) throw new Error(`No CEFR level covers mini-level ${parsed}`);

  return match;
}

/**
 * Non-throwing variant for use inside validation refinements.
 *
 * Zod 4 runs refinements even after the base shape has failed, so a refinement
 * that calls the throwing variant would escape safeParse as an exception. A
 * null result means the mini-level was already rejected upstream, and the
 * refinement should stay quiet rather than pile on a second error.
 */
export function cefrForMiniLevelOrNull(miniLevel: unknown): CEFRLevel | null {
  const parsed = miniLevelSchema.safeParse(miniLevel);
  if (!parsed.success) return null;

  return cefrForMiniLevel(parsed.data);
}

export function nextMiniLevel(
  miniLevel: number,
): { miniLevel: MiniLevel; cefr: CEFRLevel } | null {
  const parsed = miniLevelSchema.parse(miniLevel);
  if (parsed === MAX_MINI_LEVEL) return null;

  const next = parsed + 1;
  return { miniLevel: next, cefr: cefrForMiniLevel(next) };
}

/**
 * The level a learner is actually operating at. The plus modifier expresses
 * "comfortably within this level and reaching into the next". B1 is the top of
 * the path, so B1+ is not expressible: it would mean B2, which the product
 * does not teach or claim.
 */
export const effectiveLevelSchema = z
  .object({
    cefr: cefrLevelSchema,
    plus: z.boolean(),
  })
  .refine((level) => !(level.cefr === "B1" && level.plus), {
    error: "B1 is the top of the path, so it carries no plus modifier",
    path: ["plus"],
  });

export type EffectiveLevel = z.infer<typeof effectiveLevelSchema>;

export function formatEffectiveLevel(level: EffectiveLevel): string {
  return level.plus ? `${level.cefr}+` : level.cefr;
}
