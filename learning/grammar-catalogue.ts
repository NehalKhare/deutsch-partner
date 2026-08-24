import { cefrForMiniLevel } from "@/domain/cefr";
import type { GrammarPattern } from "@/domain/grammar";
import { CURRICULUM_ENTRIES } from "@/learning/curriculum";
import { GRAMMAR_LABELS } from "@/learning/grammar-labels";
import { GRAMMAR_SEEDS, type GrammarSeed } from "@/learning/grammar-seeds";

/**
 * The grammar catalogue: every pattern as a row the database can hold.
 *
 * Three sources meet here and none repeats another. The curriculum says which
 * level first teaches a pattern; GRAMMAR_LABELS gives it its name; the seeds
 * give it an explanation, examples and the mistakes worth naming.
 *
 * No id: `key` is unique in the database and is what the seed conflicts on,
 * so the rows stay stable across re-seeding without inventing identifiers.
 */

export type GrammarSeedItem = Omit<GrammarPattern, "id">;

/** The five bands the path divides into, so difficulty rises with the level. */
const LEVELS_PER_BAND = 14;

function difficultyFor(seed: GrammarSeed, miniLevel: number): number {
  return seed.difficulty ?? Math.min(5, Math.ceil(miniLevel / LEVELS_PER_BAND));
}

/**
 * The label reads inside a sentence; the name has to stand on its own, so the
 * leading article goes and the first letter is raised.
 */
function nameFor(key: string): string {
  const label = GRAMMAR_LABELS[key].replace(/^the /, "");

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The first level that targets each slug, which is where it is taught. */
const introducedAt = new Map<string, number>();
CURRICULUM_ENTRIES.forEach((entry, index) => {
  for (const key of entry.grammar) {
    if (!introducedAt.has(key)) introducedAt.set(key, index + 1);
  }
});

export const GRAMMAR_CATALOGUE: readonly GrammarSeedItem[] = Object.freeze(
  GRAMMAR_SEEDS.map((seed) => {
    const miniLevel = introducedAt.get(seed.key);

    // Unreachable while the coverage test passes; throwing here means a
    // pattern the curriculum never teaches cannot reach the database.
    if (miniLevel === undefined) {
      throw new Error(`no curriculum level teaches ${seed.key}`);
    }

    return {
      key: seed.key,
      name: nameFor(seed.key),
      explanation: seed.explanation,
      examples: seed.examples,
      cefr: cefrForMiniLevel(miniLevel),
      miniLevel,
      difficulty: difficultyFor(seed, miniLevel),
      commonMistakes: seed.mistakes,
      relatedPatternKeys: seed.related,
    };
  }),
);
