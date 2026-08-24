import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { VOCABULARY_CATALOGUE } from "@/learning/vocabulary-catalogue";
import {
  VOCABULARY_MIGRATION_FILE,
  renderVocabularySeed,
} from "@/learning/vocabulary-sql";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  VOCABULARY_MIGRATION_FILE,
);
const sql = renderVocabularySeed(VOCABULARY_CATALOGUE);

describe("the generated vocabulary seed", () => {
  it("inserts every word in the catalogue", () => {
    const rows = sql.match(/^ {2}\('/gm) ?? [];

    expect(rows).toHaveLength(VOCABULARY_CATALOGUE.length);
  });

  it("conflicts on the natural key, not on a generated id", () => {
    // The ids come from the database. Conflicting on the primary key would
    // add a second row for the same word on every re-seed.
    expect(sql).toMatch(/on conflict \(lemma, part_of_speech\) do update set/i);
  });

  it("never rewrites the key it conflicts on", () => {
    expect(sql).not.toMatch(/^ {2}lemma = excluded\.lemma/m);
    expect(sql).not.toMatch(/^ {2}part_of_speech = excluded\./m);
  });

  it("escapes an apostrophe rather than ending the string", () => {
    const rendered = renderVocabularySeed([
      { ...VOCABULARY_CATALOGUE[0], englishTranslation: "someone's name" },
    ]);

    expect(rendered).toContain("'someone''s name'");
  });

  it("writes a missing gender as null, not as an empty string", () => {
    const verb = VOCABULARY_CATALOGUE.find((item) => item.partOfSpeech === "verb");
    const rendered = renderVocabularySeed([verb!]);

    expect(rendered).toContain("'verb',\n   null, null,");
  });

  it("emits no double quote, which the migration hygiene gate forbids", () => {
    expect(sql).not.toContain('"');
  });

  it("names a migration file that exists", () => {
    expect(VOCABULARY_MIGRATION_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("matches the committed migration exactly", () => {
    expect(readFileSync(migrationPath, "utf8")).toBe(sql);
  });
});
