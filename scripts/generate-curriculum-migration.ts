import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CURRICULUM_MIGRATION_FILE,
  renderCurriculumSeed,
} from "../learning/curriculum-sql";
import { MINI_LEVEL_CURRICULUM } from "../learning/mini-levels";
import { GRAMMAR_CATALOGUE } from "../learning/grammar-catalogue";
import {
  GRAMMAR_MIGRATION_FILE,
  renderGrammarSeed,
} from "../learning/grammar-sql";
import { VOCABULARY_CATALOGUE } from "../learning/vocabulary-catalogue";
import {
  VOCABULARY_MIGRATION_FILE,
  renderVocabularySeed,
} from "../learning/vocabulary-sql";

/**
 * Writes the seed migrations from the TypeScript curriculum and lexicon.
 *
 * Run after changing the curriculum, the lexicon or the grammar seeds. The drift
 * tests under tests/unit/learning fail until you do.
 */
function write(file: string, contents: string, summary: string): void {
  writeFileSync(join(process.cwd(), "supabase", "migrations", file), contents, "utf8");
  process.stdout.write(`Wrote ${summary} to ${file}\n`);
}

write(
  CURRICULUM_MIGRATION_FILE,
  renderCurriculumSeed(MINI_LEVEL_CURRICULUM),
  `${MINI_LEVEL_CURRICULUM.length} mini-levels`,
);

write(
  VOCABULARY_MIGRATION_FILE,
  renderVocabularySeed(VOCABULARY_CATALOGUE),
  `${VOCABULARY_CATALOGUE.length} words`,
);

write(
  GRAMMAR_MIGRATION_FILE,
  renderGrammarSeed(GRAMMAR_CATALOGUE),
  `${GRAMMAR_CATALOGUE.length} grammar patterns`,
);
