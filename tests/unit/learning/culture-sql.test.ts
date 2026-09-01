import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CULTURE_CATALOGUE } from "@/learning/culture-catalogue";
import { CULTURE_MIGRATION_FILE, renderCultureSeed } from "@/learning/culture-sql";
import { GRAMMAR_MIGRATION_FILE } from "@/learning/grammar-sql";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  CULTURE_MIGRATION_FILE,
);
const sql = renderCultureSeed(CULTURE_CATALOGUE);

describe("the generated culture seed", () => {
  it("inserts every note in the catalogue", () => {
    expect(sql.match(/^ {2}\('/gm) ?? []).toHaveLength(CULTURE_CATALOGUE.length);
  });

  it("names the category column, which the grammar seed must never do", () => {
    // The grammar seed's timestamp predates the column; this file's does not.
    // Only one of the two may know the column exists.
    expect(sql).toMatch(/insert into public\.grammar_patterns \(.*category\)/);
    expect(CULTURE_MIGRATION_FILE > GRAMMAR_MIGRATION_FILE).toBe(true);
  });

  it("conflicts on the key, which is what prompts refer to", () => {
    expect(sql).toMatch(/on conflict \(key\) do update set/i);
  });

  it("never rewrites the key it conflicts on", () => {
    expect(sql).not.toMatch(/^ {2}key = excluded\.key/m);
  });

  it("emits no double quote, which the migration hygiene gate forbids", () => {
    expect(sql).not.toContain('"');
  });

  it("names a migration file that exists", () => {
    expect(CULTURE_MIGRATION_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("matches the committed migration exactly", () => {
    expect(readFileSync(migrationPath, "utf8")).toBe(sql);
  });
});
