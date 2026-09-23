import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ALICE, createTestDatabase, type TestDatabase } from "@dp/db/testing/harness";

/**
 * The search functions against a real engine.
 *
 * PGlite has no pgvector, so the vector arm cannot be called here — its
 * signature is created and its grants are checked, and its ranking is a
 * property of pgvector rather than of this code. The lexical arm is exercised
 * in full, including the part that matters most: it filters by level before it
 * ranks, so the most textually relevant chunk in the corpus still does not
 * reach a learner who cannot read it.
 */

let database: TestDatabase;

async function seedChunk(
  documentId: number,
  hash: string,
  content: string,
  over: Record<string, unknown> = {},
) {
  const columns = {
    cefr: "A2",
    mini_level: 26,
    topic: "travel",
    skill: "grammar",
    grammar_target: "dative_prepositions",
    content_type: "grammar",
    difficulty: 3,
    token_count: 20,
    ...over,
  };

  await database.db.query(
    `insert into public.knowledge_chunks
       (document_id, chunk_index, content, chunk_hash, token_count, cefr,
        mini_level, topic, skill, grammar_target, content_type, difficulty)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      documentId,
      Number(hash.replace(/\D/gu, "")) || 0,
      content,
      hash,
      columns.token_count,
      columns.cefr,
      columns.mini_level,
      columns.topic,
      columns.skill,
      columns.grammar_target,
      columns.content_type,
      columns.difficulty,
    ],
  );
}

async function documentId(): Promise<number> {
  const rows = await database.db.query<{ id: number }>(
    `insert into public.knowledge_documents (source, title, content_type, content_hash)
     values ('t', 't', 'grammar', 'h-' || gen_random_uuid()::text)
     returning id`,
  );
  return Number(rows.rows[0].id);
}

async function lexical(
  query: string,
  args: {
    cefr?: string[] | null;
    maxMiniLevel?: number | null;
    contentTypes?: string[] | null;
    limit?: number;
  } = {},
) {
  const rows = await database.db.query<{ id: number; content: string; rank: number }>(
    `select id, content, rank from public.search_knowledge_lexical($1, $2, $3, $4, $5)`,
    [
      query,
      args.cefr ?? null,
      args.maxMiniLevel ?? null,
      args.contentTypes ?? null,
      args.limit ?? 24,
    ],
  );
  return rows.rows;
}

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedLearner(ALICE);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.exec(`
    delete from public.knowledge_chunks;
    delete from public.knowledge_documents;
  `);
});

describe("the lexical index", () => {
  it("stems German, so a plural finds its singular", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Wohnungen in Berlin sind teuer.");

    expect(await lexical("Wohnung")).toHaveLength(1);
  });

  it("keeps umlauts and eszett distinct", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Die Straße ist lang.");

    expect(await lexical("Straße")).toHaveLength(1);
  });

  it("drops German stop words rather than matching on them", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Der Dativ folgt auf mit und nach.");

    // "und" is a stop word; matching on it would return every chunk.
    expect(await lexical("und")).toHaveLength(0);
  });

  it("ranks the chunk that says it more often above one that mentions it once", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Der Dativ. Der Dativ folgt auf mit. Dativ überall.");
    await seedChunk(id, "c2", "Ein Satz, in dem Dativ einmal vorkommt, und sonst nichts.");

    const results = await lexical("Dativ");

    expect(results[0].id).toBeLessThanOrEqual(results[1].id);
    expect(results[0].rank).toBeGreaterThanOrEqual(results[1].rank);
  });

  it("takes a learner's sentence without choking on its punctuation", async () => {
    // to_tsquery would raise a syntax error here; websearch_to_tsquery does not.
    const id = await documentId();
    await seedChunk(id, "c1", "Der Dativ folgt auf mit.");

    await expect(lexical("Warum sagt man 'mit dem Zug'? Und wieso nicht der?")).resolves
      .toBeDefined();
  });

  it("returns nothing for an empty query rather than everything", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Der Dativ folgt auf mit.");

    expect(await lexical("")).toHaveLength(0);
  });
});

describe("filtering happens before ranking", () => {
  it("excludes a band the learner may not see", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Dativ Dativ Dativ auf B1-Niveau erklärt.", {
      cefr: "B1",
      mini_level: 50,
    });
    await seedChunk(id, "c2", "Dativ einmal, auf A2-Niveau.", {
      cefr: "A2",
      mini_level: 26,
    });

    const results = await lexical("Dativ", { cefr: ["A1", "A2"] });

    // The B1 chunk is the better textual match and is still not returned.
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("A2-Niveau");
  });

  it("excludes a mini-level beyond the learner's reach", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Dativ weit vorne.", { mini_level: 60, cefr: "B1" });
    await seedChunk(id, "c2", "Dativ hier.", { mini_level: 20 });

    const results = await lexical("Dativ", { maxMiniLevel: 32 });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Dativ hier.");
  });

  it("keeps a chunk with no mini-level on it", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Dativ ohne Stufe.", { mini_level: null });

    expect(await lexical("Dativ", { maxMiniLevel: 5 })).toHaveLength(1);
  });

  it("narrows by content type when asked", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Dativ im Dialog.", { content_type: "dialogue" });
    await seedChunk(id, "c2", "Dativ in der Grammatik.", { content_type: "grammar" });

    const results = await lexical("Dativ", { contentTypes: ["dialogue"] });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Dativ im Dialog.");
  });

  it("filters nothing when given no filter", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Dativ eins.", { cefr: "B1", mini_level: 60 });
    await seedChunk(id, "c2", "Dativ zwei.", { cefr: "A1", mini_level: 2 });

    expect(await lexical("Dativ")).toHaveLength(2);
  });

  it("honours the limit and caps it", async () => {
    const id = await documentId();
    for (let index = 0; index < 6; index += 1) {
      await seedChunk(id, `c${index}`, `Dativ Nummer ${index}.`);
    }

    expect(await lexical("Dativ", { limit: 2 })).toHaveLength(2);
    expect(await lexical("Dativ", { limit: 10_000 })).toHaveLength(6);
  });
});

describe("the vector arm", () => {
  it("exists with the signature the repository calls", async () => {
    const rows = await database.db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc
        where proname = 'search_knowledge_vector'`,
    );

    expect(Number(rows.rows[0].n)).toBe(1);
  });

  it("is readable by a signed-in learner and by nobody else", async () => {
    const rows = await database.db.query<{ grantee: string }>(
      `select grantee from information_schema.routine_privileges
        where routine_name in ('search_knowledge_vector', 'search_knowledge_lexical')
        order by grantee`,
    );

    const grantees = new Set(rows.rows.map((row) => row.grantee));

    expect(grantees.has("authenticated")).toBe(true);
    expect(grantees.has("anon")).toBe(false);
    expect(grantees.has("PUBLIC")).toBe(false);
  });
});

describe("who may search", () => {
  it("lets a signed-in learner run a lexical search", async () => {
    const id = await documentId();
    await seedChunk(id, "c1", "Der Dativ folgt auf mit.");

    await database.asLearner(ALICE, async () => {
      const rows = await database.db.query(
        `select id from public.search_knowledge_lexical('Dativ', null, null, null, 5)`,
      );
      expect(rows.rows).toHaveLength(1);
    });
  });

  it("lets an unauthenticated visitor run none", async () => {
    await database.asAnon(async () => {
      await expect(
        database.db.query(
          `select id from public.search_knowledge_lexical('Dativ', null, null, null, 5)`,
        ),
      ).rejects.toThrow();
    });
  });
});
