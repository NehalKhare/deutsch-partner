import { cefrForMiniLevel } from "@dp/domain/cefr";
import { CURRICULUM_ENTRIES } from "./curriculum";
import { CULTURE_LABELS } from "./culture-labels";
import { CULTURE_SEEDS } from "./culture-seeds";
import type { GrammarSeedItem } from "./grammar-catalogue";
import type { GrammarSeed } from "./grammar-seeds";

/**
 * The culture catalogue: every culture note as a row the database can hold.
 *
 * A mirror of learning/grammar-catalogue.ts over the same table — the notes
 * live in grammar_patterns behind category = 'culture', so they ride the same
 * repository, the same teach flow and the same closing path. Three sources
 * meet here and none repeats another: the curriculum says which level first
 * teaches a note, CULTURE_LABELS gives it its name, and the seeds give it an
 * explanation, examples and the missteps worth naming.
 */

const LEVELS_PER_BAND = 14;

function difficultyFor(seed: GrammarSeed, miniLevel: number): number {
  return seed.difficulty ?? Math.min(5, Math.ceil(miniLevel / LEVELS_PER_BAND));
}

/** The label reads inside a sentence; the name has to stand on its own. */
function nameFor(key: string): string {
  const label = CULTURE_LABELS[key].replace(/^the /, "");

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The first level whose culture list targets each slug. */
const introducedAt = new Map<string, number>();
CURRICULUM_ENTRIES.forEach((entry, index) => {
  for (const key of entry.culture ?? []) {
    if (!introducedAt.has(key)) introducedAt.set(key, index + 1);
  }
});

export const CULTURE_CATALOGUE: readonly GrammarSeedItem[] = Object.freeze(
  CULTURE_SEEDS.map((seed) => {
    const miniLevel = introducedAt.get(seed.key);

    // Unreachable while the coverage test passes; throwing here means a note
    // the curriculum never teaches cannot reach the database.
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
      category: "culture" as const,
    };
  }),
);
