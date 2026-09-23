import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALICE, createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * The scenario corpus against a real engine.
 *
 * Scenarios are shared pedagogical content like the knowledge corpus:
 * readable by any signed-in learner, written only by the offline ingestion
 * script through the secret key. PGlite has no pgvector, so the vector search
 * function's ranking is not exercised here — its existence and its grants
 * are, which is what a migration can get wrong.
 */

let database: TestDatabase;

const ROW = {
  slug: "dialogue-a1-im-restaurant",
  type: "dialogue",
  kind: "dialogue",
  title: "Im Restaurant",
  title_english: "At the Restaurant",
  description: "A customer orders lunch and pays at a small German restaurant.",
  target_level: "A1",
  content: JSON.stringify({ setting: "x", lines: [] }),
  vocabulary: JSON.stringify([]),
  source: "Conversational_German_15_Dialogue_Stories.md",
  item_index: 0,
  content_hash: "a".repeat(64),
  embedding_text: "Im Restaurant / At the Restaurant",
};

async function seedScenario(over: Record<string, unknown> = {}) {
  const row = { ...ROW, ...over };
  await database.db.query(
    `insert into public.scenarios
       (slug, type, kind, title, title_english, description, target_level,
        content, vocabulary, source, item_index, content_hash, embedding_text)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      row.slug,
      row.type,
      row.kind,
      row.title,
      row.title_english,
      row.description,
      row.target_level,
      row.content,
      row.vocabulary,
      row.source,
      row.item_index,
      row.content_hash,
      row.embedding_text,
    ],
  );
}

beforeAll(async () => {
  database = await createTestDatabase();
  await seedScenario();
  await seedScenario({
    slug: "comprehension-a1-reading-ein-neuer-morgen",
    type: "comprehension",
    kind: "reading",
    title: "Ein neuer Morgen",
    title_english: "A New Morning",
    target_level: "A1",
    content: JSON.stringify({ passage: "Anna steht auf.", questions: [] }),
    item_index: 1,
    content_hash: "b".repeat(64),
  });
});

afterAll(async () => {
  await database.db.close();
});

describe("the scenarios table", () => {
  it("rejects a type outside the two the product knows", async () => {
    await expect(
      seedScenario({ slug: "x-bad-type", type: "quiz", content_hash: "c".repeat(64) }),
    ).rejects.toThrow(/check|constraint/i);
  });

  it("rejects a level outside the CEFR band the corpus carries", async () => {
    await expect(
      seedScenario({ slug: "x-bad-level", target_level: "C2", content_hash: "d".repeat(64) }),
    ).rejects.toThrow(/check|constraint/i);
  });

  it("rejects a second row with the same slug", async () => {
    await expect(seedScenario({ content_hash: "e".repeat(64) })).rejects.toThrow(
      /duplicate|unique/i,
    );
  });

  it("is readable by a signed-in learner", async () => {
    const rows = await database.asLearner(ALICE, async () => {
      return database.db.query<{ slug: string }>(
        `select slug from public.scenarios order by item_index`,
      );
    });

    expect(rows.rows.map((row) => row.slug)).toEqual([
      "dialogue-a1-im-restaurant",
      "comprehension-a1-reading-ein-neuer-morgen",
    ]);
  });

  it("is invisible to anonymous traffic", async () => {
    await expect(
      database.asAnon(async () =>
        database.db.query(`select slug from public.scenarios`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot be written by a learner", async () => {
    await expect(
      database.asLearner(ALICE, async () =>
        database.db.query(
          `insert into public.scenarios
             (slug, type, kind, title, title_english, description, target_level,
              content, vocabulary, source, item_index, content_hash, embedding_text)
           values ('x-learner', 'dialogue', 'dialogue', 't', 't', 'd', 'A1',
                   '{}', '[]', 's', 99, '${"f".repeat(64)}', 'e')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      database.asLearner(ALICE, async () =>
        database.db.query(
          `update public.scenarios set title = 'mine' where item_index = 0`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      database.asLearner(ALICE, async () =>
        database.db.query(`delete from public.scenarios where item_index = 0`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("the scenario search function", () => {
  it("exists with the signature the repository calls", async () => {
    const rows = await database.db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname = 'search_scenarios'`,
    );

    expect(Number(rows.rows[0].n)).toBe(1);
  });

  it("returns the citation columns alongside each hit", async () => {
    // The result-table columns live in proargnames (OUT parameters). A hit
    // that cannot say where it came from cannot be cited.
    const rows = await database.db.query<{ proargnames: string[] }>(
      `select proargnames from pg_proc where proname = 'search_scenarios'`,
    );

    const names = rows.rows[0].proargnames;
    expect(names).toContain("source");
    expect(names).toContain("item_index");
    expect(names).toContain("similarity");
  });

  it("is callable by a signed-in learner and by nobody else", async () => {
    const rows = await database.db.query<{ grantee: string }>(
      `select grantee from information_schema.routine_privileges
        where routine_name = 'search_scenarios'
        order by grantee`,
    );

    const grantees = new Set(rows.rows.map((row) => row.grantee));

    expect(grantees.has("authenticated")).toBe(true);
    expect(grantees.has("anon")).toBe(false);
    expect(grantees.has("PUBLIC")).toBe(false);
  });
});
