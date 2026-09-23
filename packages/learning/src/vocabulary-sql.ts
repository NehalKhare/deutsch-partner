import type { VocabularySeedItem } from "./vocabulary-catalogue";
import { quoteLiteral, textArray } from "./sql-literals";

/**
 * Renders the catalogue as the vocabulary seed migration.
 *
 * Same contract as the mini-level seed: generated from TypeScript, idempotent,
 * and compared against the committed file by a test. The conflict target is
 * `(lemma, part_of_speech)` rather than the primary key, because the ids are
 * assigned by the database and re-seeding must update the existing row rather
 * than add a second one.
 */

export const VOCABULARY_MIGRATION_FILE = "20260821121200_seed_vocabulary_items.sql";

const COLUMNS = [
  "lemma",
  "word",
  "part_of_speech",
  "gender",
  "plural",
  "english_translation",
  "german_definition",
  "example",
  "collocations",
  "common_mistakes",
  "cefr",
  "mini_level",
  "topic",
  "frequency_band",
  "is_core_word",
] as const;

const UPDATED = COLUMNS.filter(
  (column) => column !== "lemma" && column !== "part_of_speech",
);

const nullable = (value: string | null) =>
  value === null ? "null" : quoteLiteral(value);

function renderRow(item: VocabularySeedItem): string {
  return [
    `  (${quoteLiteral(item.lemma)}, ${quoteLiteral(item.word)}, ${quoteLiteral(item.partOfSpeech)},`,
    `   ${nullable(item.gender)}, ${nullable(item.plural)},`,
    `   ${quoteLiteral(item.englishTranslation)},`,
    `   ${quoteLiteral(item.germanDefinition)},`,
    `   ${quoteLiteral(item.example)},`,
    `   ${textArray(item.collocations)}, ${textArray(item.commonMistakes)},`,
    `   ${quoteLiteral(item.cefr)}, ${item.miniLevel}, ${quoteLiteral(item.topic)}, ` +
      `${item.frequencyBand}, ${item.isCoreWord})`,
  ].join("\n");
}

export function renderVocabularySeed(
  catalogue: readonly VocabularySeedItem[],
): string {
  const header = [
    "-- Generated from learning/lexicon.ts. Do not edit by hand.",
    "-- Regenerate with: pnpm curriculum:generate",
    "--",
    "-- Shared reference content: the words the curriculum targets, with the",
    "-- level that introduces each one. Learner progress points at these rows,",
    "-- so they must exist before any vocabulary can be recorded.",
    "",
    `insert into public.vocabulary_items (${COLUMNS.join(", ")})`,
    "values",
  ].join("\n");

  const conflict = [
    "on conflict (lemma, part_of_speech) do update set",
    UPDATED.map((column) => `  ${column} = excluded.${column}`).join(",\n"),
  ].join("\n");

  return `${header}\n${catalogue.map(renderRow).join(",\n")}\n${conflict};\n`;
}
