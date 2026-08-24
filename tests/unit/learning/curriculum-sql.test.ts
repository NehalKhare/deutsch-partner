import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CURRICULUM_MIGRATION_FILE,
  renderCurriculumSeed,
} from "@/learning/curriculum-sql";
import { MINI_LEVEL_CURRICULUM } from "@/learning/mini-levels";

const sql = renderCurriculumSeed(MINI_LEVEL_CURRICULUM);

describe("the generated seed", () => {
  it("inserts every mini-level", () => {
    const inserted = [...sql.matchAll(/^\s*\((\d+), '/gm)].map((match) =>
      Number(match[1]),
    );

    expect(inserted).toEqual(
      MINI_LEVEL_CURRICULUM.map((level) => level.miniLevel),
    );
  });

  it("is idempotent, so re-running a migration is safe", () => {
    expect(sql).toMatch(/on conflict \(mini_level\) do update set/i);
  });

  it("escapes a quote in the content instead of ending the string", () => {
    const rendered = renderCurriculumSeed([
      { ...MINI_LEVEL_CURRICULUM[0], theme: "Karl's Thema" },
    ]);

    expect(rendered).toContain("'Karl''s Thema'");
  });

  it("emits no double quote, which the migration hygiene gate forbids", () => {
    expect(sql).not.toContain('"');
  });

  it("builds the criteria as jsonb without a single double quote", () => {
    // A JSON literal would carry quoted keys, which the migration hygiene
    // gate reads as quoted mixed-case identifiers.
    const first = MINI_LEVEL_CURRICULUM[0];

    expect(sql).toContain(
      `jsonb_build_object('vocabularyMastered', ${first.masteryCriteria.vocabularyMastered}`,
    );
  });

  it("names a migration file that exists", () => {
    expect(CURRICULUM_MIGRATION_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(
      existsSync(join(process.cwd(), "supabase", "migrations", CURRICULUM_MIGRATION_FILE)),
    ).toBe(true);
  });

  it("matches the committed migration exactly", () => {
    // The TypeScript curriculum is the single source of truth; the migration
    // is generated from it. Editing either alone is drift, and drift here
    // means the database and the application disagree about the syllabus.
    const committed = readFileSync(
      join(process.cwd(), "supabase", "migrations", CURRICULUM_MIGRATION_FILE),
      "utf8",
    );

    expect(committed).toBe(sql);
  });
});
