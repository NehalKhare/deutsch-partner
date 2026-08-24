import type { GrammarSeedItem } from "@/learning/grammar-catalogue";
import { quoteLiteral, textArray } from "@/learning/sql-literals";

/**
 * Renders the grammar catalogue as its seed migration.
 *
 * Same contract as the other two seeds: generated from TypeScript, idempotent,
 * and compared against the committed file by a test. The conflict target is
 * `key`, the stable identifier retrieval and prompts refer to, rather than the
 * database-assigned id.
 */

export const GRAMMAR_MIGRATION_FILE = "20260821121400_seed_grammar_patterns.sql";

const COLUMNS = [
  "key",
  "name",
  "explanation",
  "examples",
  "cefr",
  "mini_level",
  "difficulty",
  "common_mistakes",
  "related_pattern_keys",
] as const;

const UPDATED = COLUMNS.filter((column) => column !== "key");

function renderRow(pattern: GrammarSeedItem): string {
  return [
    `  (${quoteLiteral(pattern.key)}, ${quoteLiteral(pattern.name)},`,
    `   ${quoteLiteral(pattern.explanation)},`,
    `   ${textArray(pattern.examples)},`,
    `   ${quoteLiteral(pattern.cefr)}, ${pattern.miniLevel}, ${pattern.difficulty},`,
    `   ${textArray(pattern.commonMistakes)},`,
    `   ${textArray(pattern.relatedPatternKeys)})`,
  ].join("\n");
}

export function renderGrammarSeed(
  catalogue: readonly GrammarSeedItem[],
): string {
  const header = [
    "-- Generated from learning/grammar-seeds.ts. Do not edit by hand.",
    "-- Regenerate with: pnpm curriculum:generate",
    "--",
    "-- Shared reference content: what the tutor quotes when it corrects",
    "-- somebody. common_mistakes carries the wrong form and the right one, so",
    "-- a correction can name the exact sentence a learner keeps producing.",
    "",
    `insert into public.grammar_patterns (${COLUMNS.join(", ")})`,
    "values",
  ].join("\n");

  const conflict = [
    "on conflict (key) do update set",
    UPDATED.map((column) => `  ${column} = excluded.${column}`).join(",\n"),
  ].join("\n");

  return `${header}\n${catalogue.map(renderRow).join(",\n")}\n${conflict};\n`;
}
