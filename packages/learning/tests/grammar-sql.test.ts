import { describe, expect, it } from "vitest";

import { MIGRATIONS_DIR } from "@dp/db/testing/harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { GRAMMAR_CATALOGUE } from "../src/grammar-catalogue";
import { GRAMMAR_MIGRATION_FILE, renderGrammarSeed } from "../src/grammar-sql";

const migrationPath = join(MIGRATIONS_DIR, GRAMMAR_MIGRATION_FILE,
);
const sql = renderGrammarSeed(GRAMMAR_CATALOGUE);

describe("the generated grammar seed", () => {
  it("inserts every pattern in the catalogue", () => {
    expect(sql.match(/^ {2}\('/gm) ?? []).toHaveLength(GRAMMAR_CATALOGUE.length);
  });

  it("conflicts on the key, which is what prompts refer to", () => {
    expect(sql).toMatch(/on conflict \(key\) do update set/i);
  });

  it("never rewrites the key it conflicts on", () => {
    expect(sql).not.toMatch(/^ {2}key = excluded\.key/m);
  });

  it("escapes an apostrophe rather than ending the string", () => {
    const rendered = renderGrammarSeed([
      { ...GRAMMAR_CATALOGUE[0], name: "Someone's rule" },
    ]);

    expect(rendered).toContain("'Someone''s rule'");
  });

  it("writes an empty related list as an empty array, not as null", () => {
    const rendered = renderGrammarSeed([
      { ...GRAMMAR_CATALOGUE[0], relatedPatternKeys: [] },
    ]);

    expect(rendered).toContain("'{}'::text[]");
  });

  it("emits no double quote, which the migration hygiene gate forbids", () => {
    expect(sql).not.toContain('"');
  });

  it("names a migration file that exists", () => {
    expect(GRAMMAR_MIGRATION_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("matches the committed migration exactly", () => {
    expect(readFileSync(migrationPath, "utf8")).toBe(sql);
  });
});
