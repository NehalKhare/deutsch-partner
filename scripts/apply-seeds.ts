import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { CURRICULUM_MIGRATION_FILE } from "../learning/curriculum-sql";
import { GRAMMAR_MIGRATION_FILE } from "../learning/grammar-sql";
import { VOCABULARY_MIGRATION_FILE } from "../learning/vocabulary-sql";

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
 * Run with: pnpm db:seed
 */
const SEEDS = [
  CURRICULUM_MIGRATION_FILE,
  VOCABULARY_MIGRATION_FILE,
  GRAMMAR_MIGRATION_FILE,
];

for (const file of SEEDS) {
  process.stdout.write(`Applying ${file}\n`);
  execFileSync(
    "supabase",
    ["db", "query", "--linked", "--file", join("supabase", "migrations", file)],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

process.stdout.write(`Applied ${SEEDS.length} seed migrations.\n`);
