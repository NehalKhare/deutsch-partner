import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ALICE, createTestDatabase, type TestDatabase } from "./harness";

/**
 * Ingestion against a real engine.
 *
 * The property the whole pipeline rests on is that running it twice converges
 * rather than accumulating, and that only holds if the SQL says so. PGlite has
 * no pgvector, so the harness substitutes the embedding column for text; the
 * upsert, the removal of dropped chunks and the transaction boundary are all
 * exactly as deployed.
 */

let database: TestDatabase;

const HASH = "doc-hash-1";

function document(over: Record<string, unknown> = {}) {
  return {
    source: "test/grammar/dativ",
    title: "The dative case",
    content_type: "grammar",
    language: "en",
    cefr: "A2",
    license: "internal",
    attribution: null,
    content_hash: HASH,
    metadata: { origin: "test" },
    ...over,
  };
}

function chunk(index: number, hash: string, over: Record<string, unknown> = {}) {
  return {
    chunk_index: index,
    content: `Chunk ${index}`,
    chunk_hash: hash,
    token_count: 12,
    cefr: "A2",
    mini_level: 20,
    topic: "travel",
    skill: "grammar",
    grammar_target: "two_way_prepositions",
    content_type: "grammar",
    difficulty: 3,
    embedding: null,
    metadata: {},
    ...over,
  };
}

async function ingest(doc: unknown, chunks: unknown[]) {
  const result = await database.db.query<{ ingest_document: Record<string, unknown> }>(
    `select public.ingest_document($1::jsonb, $2::jsonb)`,
    [JSON.stringify(doc), JSON.stringify(chunks)],
  );
  return result.rows[0].ingest_document as {
    document_id: number;
    created: boolean;
    chunks_written: number;
    chunks_removed: number;
  };
}

const countChunks = async (documentId: number) =>
  Number(
    (
      await database.db.query<{ n: number }>(
        `select count(*)::int as n from public.knowledge_chunks where document_id = $1`,
        [documentId],
      )
    ).rows[0].n,
  );

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
    delete from public.embedding_cache;
  `);
});

describe("ingest_document", () => {
  it("creates a document and its chunks", async () => {
    const result = await ingest(document(), [chunk(0, "a"), chunk(1, "b")]);

    expect(result.created).toBe(true);
    expect(result.chunks_written).toBe(2);
    expect(await countChunks(result.document_id)).toBe(2);
  });

  it("creates no duplicate on a second identical run", async () => {
    const first = await ingest(document(), [chunk(0, "a"), chunk(1, "b")]);
    const second = await ingest(document(), [chunk(0, "a"), chunk(1, "b")]);

    expect(second.document_id).toBe(first.document_id);
    expect(second.created).toBe(false);
    expect(await countChunks(first.document_id)).toBe(2);

    const documents = await database.db.query<{ n: number }>(
      `select count(*)::int as n from public.knowledge_documents`,
    );
    expect(Number(documents.rows[0].n)).toBe(1);
  });

  it("updates a document's title in place rather than forking it", async () => {
    const first = await ingest(document(), [chunk(0, "a")]);
    await ingest(document({ title: "The dative, corrected" }), [chunk(0, "a")]);

    const rows = await database.db.query<{ id: number; title: string }>(
      `select id, title from public.knowledge_documents`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      id: first.document_id,
      title: "The dative, corrected",
    });
  });

  it("removes a chunk the source no longer produces", async () => {
    const first = await ingest(document(), [chunk(0, "a"), chunk(1, "b"), chunk(2, "c")]);
    const second = await ingest(document(), [chunk(0, "a"), chunk(1, "b")]);

    expect(second.chunks_removed).toBe(1);
    expect(await countChunks(first.document_id)).toBe(2);
  });

  it("rewrites a chunk whose text changed under the same index", async () => {
    const first = await ingest(document(), [chunk(0, "a", { content: "Alt" })]);
    await ingest(document(), [chunk(0, "b", { content: "Neu" })]);

    const rows = await database.db.query<{ content: string }>(
      `select content from public.knowledge_chunks where document_id = $1`,
      [first.document_id],
    );

    expect(rows.rows.map((row) => row.content)).toEqual(["Neu"]);
  });

  it("keeps the stored vector when a re-run supplies none", async () => {
    // A run that hit the embedding cache has nothing new to write, and nulling
    // the vector would make the chunk invisible to retrieval.
    const first = await ingest(document(), [chunk(0, "a", { embedding: "[0.1,0.2]" })]);
    await ingest(document(), [chunk(0, "a", { embedding: null, content: "Neu" })]);

    const rows = await database.db.query<{ embedding: string | null }>(
      `select embedding::text as embedding from public.knowledge_chunks
        where document_id = $1`,
      [first.document_id],
    );

    expect(rows.rows[0].embedding).toContain("0.1");
  });

  it("refuses a document with no content hash", async () => {
    await expect(
      ingest(document({ content_hash: null }), [chunk(0, "a")]),
    ).rejects.toThrow(/hash of its own content/);
  });

  it("ignores a key that is not a column", async () => {
    await ingest(document({ secret_field: "nope" }), [chunk(0, "a")]);

    const columns = await database.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'knowledge_documents'`,
    );

    expect(columns.rows.map((row) => row.column_name)).not.toContain("secret_field");
  });

  it("writes nothing when one chunk is rejected", async () => {
    // The whole document moves or none of it does: a half-written document
    // answers questions from text it no longer contains.
    await expect(
      ingest(document(), [chunk(0, "a"), chunk(1, "b", { cefr: "C1" })]),
    ).rejects.toThrow();

    const documents = await database.db.query<{ n: number }>(
      `select count(*)::int as n from public.knowledge_documents`,
    );
    expect(Number(documents.rows[0].n)).toBe(0);
  });

  it("stores a document with no chunks at all as a document with no chunks", async () => {
    const result = await ingest(document(), []);

    expect(result.chunks_written).toBe(0);
    expect(await countChunks(result.document_id)).toBe(0);
  });

  it("removes every chunk when a document is deleted", async () => {
    const first = await ingest(document(), [chunk(0, "a"), chunk(1, "b")]);

    await database.db.query(`delete from public.knowledge_documents where id = $1`, [
      first.document_id,
    ]);

    expect(await countChunks(first.document_id)).toBe(0);
  });
});

describe("the embedding cache", () => {
  it("keeps one row per model and content hash", async () => {
    await database.db.exec(`
      insert into public.embedding_cache (model_id, content_hash, dimensions, embedding)
      values ('m1', 'h1', 2, '[0.1,0.2]'), ('m2', 'h1', 2, '[0.3,0.4]');
    `);

    const rows = await database.db.query<{ n: number }>(
      `select count(*)::int as n from public.embedding_cache where content_hash = 'h1'`,
    );

    // Two models, two vectors. Mixing them would poison every similarity score.
    expect(Number(rows.rows[0].n)).toBe(2);
  });

  it("refuses a second row for the same model and hash", async () => {
    await database.db.exec(
      `insert into public.embedding_cache (model_id, content_hash, dimensions, embedding)
       values ('m1', 'h1', 2, '[0.1,0.2]')`,
    );

    await expect(
      database.db.exec(
        `insert into public.embedding_cache (model_id, content_hash, dimensions, embedding)
         values ('m1', 'h1', 2, '[0.9,0.9]')`,
      ),
    ).rejects.toThrow();
  });
});

describe("who may write the corpus", () => {
  it("lets a learner read a chunk", async () => {
    await ingest(document(), [chunk(0, "a")]);

    await database.asLearner(ALICE, async () => {
      const rows = await database.db.query(`select id from public.knowledge_chunks`);
      expect(rows.rows.length).toBeGreaterThan(0);
    });
  });

  it("lets no learner write one", async () => {
    await database.asLearner(ALICE, async () => {
      await expect(
        database.db.query(
          `insert into public.knowledge_documents
             (source, title, content_type, content_hash)
           values ('x', 'x', 'grammar', 'x')`,
        ),
      ).rejects.toThrow();
    });
  });

  it("lets no learner call the ingestion function", async () => {
    await database.asLearner(ALICE, async () => {
      await expect(
        database.db.query(`select public.ingest_document($1::jsonb, '[]'::jsonb)`, [
          JSON.stringify(document()),
        ]),
      ).rejects.toThrow();
    });
  });

  it("hides the embedding cache from a learner entirely", async () => {
    await database.asLearner(ALICE, async () => {
      await expect(
        database.db.query(`select * from public.embedding_cache`),
      ).rejects.toThrow();
    });
  });
});
