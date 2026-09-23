import type { GrammarSeedItem } from "./grammar-catalogue";
import { quoteLiteral, textArray } from "./sql-literals";

/**
 * Renders the culture catalogue as its seed migration.
 *
 * A sibling of learning/grammar-sql.ts over the same table, with one
 * difference that matters: this file's timestamp comes after the migration
 * that added the category column, so it may name the column — the grammar
 * seed, whose timestamp predates it, may not.
 */

export const CULTURE_MIGRATION_FILE = "20260901130000_seed_culture_patterns.sql";

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
  "category",
] as const;

const UPDATED = COLUMNS.filter((column) => column !== "key");

function renderRow(pattern: GrammarSeedItem): string {
  return [
    `  (${quoteLiteral(pattern.key)}, ${quoteLiteral(pattern.name)},`,
    `   ${quoteLiteral(pattern.explanation)},`,
    `   ${textArray(pattern.examples)},`,
    `   ${quoteLiteral(pattern.cefr)}, ${pattern.miniLevel}, ${pattern.difficulty},`,
    `   ${textArray(pattern.commonMistakes)},`,
    `   ${textArray(pattern.relatedPatternKeys)},`,
    `   ${quoteLiteral(pattern.category)})`,
  ].join("\n");
}

export function renderCultureSeed(
  catalogue: readonly GrammarSeedItem[],
): string {
  const header = [
    "-- Generated from learning/culture-seeds.ts. Do not edit by hand.",
    "-- Regenerate with: pnpm curriculum:generate",
    "--",
    "-- Culture and pragmatics notes: du/Sie, register, politeness. They share",
    "-- the grammar table and the teach flow; the category is what gives them",
    "-- their own slot on the trainer's agenda.",
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
