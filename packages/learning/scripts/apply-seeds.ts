import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

import { MIGRATIONS_DIR } from "@dp/db/testing/harness";

import { CULTURE_MIGRATION_FILE } from "../src/culture-sql";
import { CURRICULUM_MIGRATION_FILE } from "../src/curriculum-sql";
import { GRAMMAR_MIGRATION_FILE } from "../src/grammar-sql";
import { VOCABULARY_MIGRATION_FILE } from "../src/vocabulary-sql";

/**
 * Re-applies the generated seed migrations to the linked project.
 *
 * A migration runs once. The seeds are declarative and idempotent — every
 * column is refreshed on conflict — so when the curriculum or the lexicon
 * changes, the file changes but a database that already applied it does not.
 * This closes that gap without inventing a second migration per edit.
 *
 * A fresh database needs none of this: `supabase db push` applies the same
 * files in order.
 *
 * Run with: pnpm db:seed (from the repository root)
 */
const SEEDS = [
  CURRICULUM_MIGRATION_FILE,
  VOCABULARY_MIGRATION_FILE,
  GRAMMAR_MIGRATION_FILE,
  CULTURE_MIGRATION_FILE,
];

for (const file of SEEDS) {
  process.stdout.write(`Applying ${file}\n`);
  execFileSync(
    "supabase",
    ["db", "query", "--linked", "--file", join(MIGRATIONS_DIR, file)],
    // The CLI reads supabase/config.toml from its working directory, which is
    // the db package: the linked project and the migrations live there.
    { cwd: dirname(dirname(MIGRATIONS_DIR)), stdio: ["ignore", "ignore", "inherit"] },
  );
}

process.stdout.write(`Applied ${SEEDS.length} seed migrations.\n`);
