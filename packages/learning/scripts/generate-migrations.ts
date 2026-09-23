import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { MIGRATIONS_DIR } from "@dp/db/testing/harness";

import {
  CURRICULUM_MIGRATION_FILE,
  renderCurriculumSeed,
} from "../src/curriculum-sql";
import { MINI_LEVEL_CURRICULUM } from "../src/mini-levels";
import { CULTURE_CATALOGUE } from "../src/culture-catalogue";
import {
  CULTURE_MIGRATION_FILE,
  renderCultureSeed,
} from "../src/culture-sql";
import { GRAMMAR_CATALOGUE } from "../src/grammar-catalogue";
import {
  GRAMMAR_MIGRATION_FILE,
  renderGrammarSeed,
} from "../src/grammar-sql";
import { VOCABULARY_CATALOGUE } from "../src/vocabulary-catalogue";
import {
  VOCABULARY_MIGRATION_FILE,
  renderVocabularySeed,
} from "../src/vocabulary-sql";

/**
 * Writes the seed migrations from the TypeScript curriculum and lexicon.
 *
 * Run after changing the curriculum, the lexicon or the grammar seeds. The drift
 * tests under packages/learning/tests fail until you do.
 */
function write(file: string, contents: string, summary: string): void {
  writeFileSync(join(MIGRATIONS_DIR, file), contents, "utf8");
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

write(
  CULTURE_MIGRATION_FILE,
  renderCultureSeed(CULTURE_CATALOGUE),
  `${CULTURE_CATALOGUE.length} culture notes`,
);
