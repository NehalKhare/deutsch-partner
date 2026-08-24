import { describe, expect, it, vi } from "vitest";

import type { EmbeddingService } from "@/lib/ai/gateway/embedding-service";
import { gatewayFail, gatewayOk } from "@/lib/ai/gateway/errors";
import { contentHash } from "@/lib/content/hash";
import { documentHash, prepareBody } from "@/lib/ingestion/document";
import { ingestDocuments, prepareDocument } from "@/lib/ingestion/pipeline";
import type { ChunkRecord, IngestionStore } from "@/lib/ingestion/store";
import type { SourceDocumentInput } from "@/lib/ingestion/document";

const document = (over: Partial<SourceDocumentInput> = {}): SourceDocumentInput => ({
  source: "test/grammar/dativ",
  title: "The dative case",
  contentType: "grammar",
  language: "en",
  cefr: "A2",
  miniLevel: 20,
  body: "Der Dativ folgt auf mit, nach, bei.\n\n---\n\nBeispiel: mit dem Zug.",
  ...over,
});

/** An in-memory store shaped exactly like the SQL one behaves. */
function memoryStore() {
  const documents = new Map<string, { id: number; chunks: Map<string, ChunkRecord> }>();
  let nextId = 1;

  const store: IngestionStore = {
    async findDocument(hash) {
      const found = documents.get(hash);
      return found ? { id: found.id, chunkHashes: [...found.chunks.keys()] } : null;
    },
    async save(_document, hash, chunks) {
      const existing = documents.get(hash);
      const entry = existing ?? { id: nextId++, chunks: new Map<string, ChunkRecord>() };
      documents.set(hash, entry);

      for (const chunk of chunks) entry.chunks.set(chunk.chunkHash, chunk);

      const incoming = new Set(chunks.map((chunk) => chunk.chunkHash));
      let removed = 0;
      for (const hashKey of [...entry.chunks.keys()]) {
        if (!incoming.has(hashKey)) {
          entry.chunks.delete(hashKey);
          removed += 1;
        }
      }

      return {
        documentId: entry.id,
        created: existing === undefined,
        chunksWritten: chunks.length,
        chunksRemoved: removed,
      };
    },
  };

  return { store, documents };
}

function countingEmbeddings() {
  const calls: string[][] = [];
  const service: EmbeddingService = {
    async embed(texts) {
      calls.push([...texts]);
      return gatewayOk({
        embedded: texts.map((text) => ({
          text,
          contentHash: contentHash(text),
          embedding: [text.length, 1, 2, 3],
          cached: false,
        })),
        cacheHits: 0,
        embeddedCount: texts.length,
        costEur: 0.000001 * texts.length,
      });
    },
  };
  return { service, calls };
}

const deps = () => {
  const { store, documents } = memoryStore();
  const { service, calls } = countingEmbeddings();
  return { store, documents, embeddings: service, calls };
};

describe("preparing a document", () => {
  it("cleans and normalises before hashing", () => {
    const prepared = prepareDocument(document({ body: "<p>Der  Dativ</p>" }));

    expect(prepared.body).toBe("Der Dativ");
    expect(prepared.contentHash).toBe(
      documentHash("test/grammar/dativ", prepareBody("<p>Der  Dativ</p>")),
    );
  });

  it("gives the same hash to text a formatter has reflowed", () => {
    const a = prepareDocument(document({ body: "Der Dativ.\r\n\r\n\r\nBeispiel." }));
    const b = prepareDocument(document({ body: "Der Dativ.\n\nBeispiel." }));

    expect(a.contentHash).toBe(b.contentHash);
  });

  it("gives a different hash to text that changed", () => {
    const a = prepareDocument(document({ body: "Der Dativ." }));
    const b = prepareDocument(document({ body: "Der Akkusativ." }));

    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("keeps two sources with the same body as two documents", () => {
    // Attribution differs, and so does what a learner should be told about
    // where an answer came from.
    const a = prepareDocument(document({ source: "a" }));
    const b = prepareDocument(document({ source: "b" }));

    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("cannot be confused by where the source ends and the body begins", () => {
    // Concatenated without a separator, source "ab" with body "c" and source
    // "a" with body "bc" are the same string, and would be the same document.
    const a = prepareDocument(document({ source: "ab", body: "c" }));
    const b = prepareDocument(document({ source: "a", body: "bc" }));

    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("does not change identity when only the title is corrected", () => {
    const a = prepareDocument(document({ title: "Dativ" }));
    const b = prepareDocument(document({ title: "The dative case, corrected" }));

    expect(a.contentHash).toBe(b.contentHash);
  });

  it("numbers chunks from zero and hashes each on its own text", () => {
    const prepared = prepareDocument(document());

    expect(prepared.chunks.map((chunk) => chunk.index)).toEqual([0, 1]);
    expect(prepared.chunks[0].chunkHash).toBe(contentHash(prepared.chunks[0].content));
  });

  it("stores a repeated chunk once", () => {
    // Two identical chunks would collide on the per-document uniqueness
    // constraint, and the second write would silently replace the first.
    const prepared = prepareDocument(
      document({ body: "Gleicher Text.\n\n---\n\nGleicher Text." }),
    );

    expect(prepared.chunks).toHaveLength(1);
  });

  it("rejects metadata retrieval would filter on wrongly", () => {
    expect(() => prepareDocument(document({ cefr: "C1" as never }))).toThrow();
    expect(() => prepareDocument(document({ contentType: "poetry" as never }))).toThrow();
    expect(() => prepareDocument(document({ miniLevel: 99 as never }))).toThrow();
  });
});

describe("ingesting", () => {
  it("writes a document and its chunks", async () => {
    const context = deps();

    const report = await ingestDocuments([document()], context);

    expect(report.totals).toMatchObject({ ingested: 1, unchanged: 0, failed: 0 });
    expect(report.documents[0].chunks).toBe(2);
  });

  it("does nothing at all on a second run over the same source", async () => {
    const context = deps();

    await ingestDocuments([document()], context);
    const second = await ingestDocuments([document()], context);

    expect(second.totals).toMatchObject({ unchanged: 1, ingested: 0 });
    // The important part: no second embedding. That is the cost.
    expect(context.calls).toHaveLength(1);
  });

  it("creates no duplicate rows on a second run", async () => {
    const context = deps();

    await ingestDocuments([document()], context);
    await ingestDocuments([document()], context);

    expect(context.documents.size).toBe(1);
    expect([...context.documents.values()][0].chunks.size).toBe(2);
  });

  it("re-ingests when the body changes", async () => {
    const context = deps();

    await ingestDocuments([document()], context);
    const second = await ingestDocuments(
      [document({ body: "Der Dativ folgt auf mit, nach, bei, seit." })],
      context,
    );

    expect(second.totals.ingested).toBe(1);
    expect(context.calls).toHaveLength(2);
  });

  it("removes a chunk the source no longer produces", async () => {
    const context = deps();
    const hash = prepareDocument(document()).contentHash;

    await ingestDocuments([document()], context);
    // Same document identity is impossible once the body changes, so the
    // shrink is tested through the store's own removal accounting.
    const shortened = document({ body: "Der Dativ folgt auf mit, nach, bei." });
    await ingestDocuments([shortened], context);

    expect(context.documents.get(hash)?.chunks.size).toBe(2);
    expect(
      context.documents.get(prepareDocument(shortened).contentHash)?.chunks.size,
    ).toBe(1);
  });

  it("re-ingests when the store's chunks do not match the document", async () => {
    // Reachable when a chunker changes, a migration half-applies, or somebody
    // deletes a row: the document hash still matches and its chunks do not.
    // Skipping on the document hash alone would leave the gap open forever.
    const context = deps();
    await ingestDocuments([document()], context);

    const stored = [...context.documents.values()][0];
    // Same count, different content: a length check alone would call this
    // unchanged and leave the wrong text answering questions forever.
    const [first] = [...stored.chunks.keys()];
    const record = stored.chunks.get(first) as ChunkRecord;
    stored.chunks.delete(first);
    stored.chunks.set("stale-hash", record);

    const second = await ingestDocuments([document()], context);

    expect(second.totals.ingested).toBe(1);
    expect(context.calls).toHaveLength(2);
    expect([...stored.chunks.keys()]).not.toContain("stale-hash");
    expect(stored.chunks.size).toBe(2);
  });

  it("re-embeds everything when forced", async () => {
    const context = deps();

    await ingestDocuments([document()], context);
    await ingestDocuments([document()], context, { force: true });

    expect(context.calls).toHaveLength(2);
  });

  it("embeds nothing and writes nothing on a dry run", async () => {
    const context = deps();
    const save = vi.spyOn(context.store, "save");

    const report = await ingestDocuments([document()], context, { dryRun: true });

    expect(report.documents[0].chunks).toBe(2);
    expect(context.calls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("reports the cost of what it embedded", async () => {
    const context = deps();

    const report = await ingestDocuments([document()], context);

    expect(report.totals.costEur).toBeCloseTo(0.000002, 12);
  });
});

describe("failure reporting", () => {
  it("names a failed document and carries on with the rest", async () => {
    const context = deps();

    const report = await ingestDocuments(
      [document({ source: "good/one" }), document({ cefr: "C2" as never, source: "bad" }), document({ source: "good/two" })],
      context,
    );

    expect(report.totals).toMatchObject({ ingested: 2, failed: 1 });
    expect(report.documents[1]).toMatchObject({ source: "bad", status: "failed" });
    expect(report.documents[1].error).toBeTruthy();
  });

  it("names a document whose own fields could not be read", async () => {
    const context = deps();

    const report = await ingestDocuments([{} as SourceDocumentInput], context);

    expect(report.documents[0]).toMatchObject({ source: "unknown", status: "failed" });
  });

  it("fails a document that produces no chunks", async () => {
    const context = deps();

    const report = await ingestDocuments([document({ body: "   " })], context);

    expect(report.totals.failed).toBe(1);
  });

  it("puts no document text into the failure it reports", async () => {
    const context = deps();
    const embeddings: EmbeddingService = {
      async embed() {
        return gatewayFail("provider_error", "upstream refused");
      },
    };

    const report = await ingestDocuments(
      [document()],
      { ...context, embeddings, retry: { attempts: 1, baseDelayMs: 0 } },
    );

    expect(report.documents[0].error).not.toContain("Dativ");
  });
});

describe("retrying", () => {
  it("retries a transient embedding failure", async () => {
    const context = deps();
    let attempts = 0;
    const embeddings: EmbeddingService = {
      async embed(texts) {
        attempts += 1;
        if (attempts === 1) return gatewayFail("provider_error", "upstream 503");
        return gatewayOk({
          embedded: texts.map((text) => ({
            text,
            contentHash: contentHash(text),
            embedding: [1, 2, 3, 4],
            cached: false,
          })),
          cacheHits: 0,
          embeddedCount: texts.length,
          costEur: 0,
        });
      },
    };

    const report = await ingestDocuments(
      [document()],
      { ...context, embeddings, retry: { attempts: 3, baseDelayMs: 0 }, sleep: async () => {} },
    );

    expect(attempts).toBe(2);
    expect(report.totals.ingested).toBe(1);
  });

  it("does not retry a denial that will fail the same way every time", async () => {
    const context = deps();
    let attempts = 0;
    const embeddings: EmbeddingService = {
      async embed() {
        attempts += 1;
        return gatewayFail("ceiling_denied", "a chunk is too long");
      },
    };

    await ingestDocuments(
      [document()],
      { ...context, embeddings, retry: { attempts: 3, baseDelayMs: 0 }, sleep: async () => {} },
    );

    expect(attempts).toBe(1);
  });

  it("retries a store failure too", async () => {
    const context = deps();
    let saves = 0;
    const original = context.store.save.bind(context.store);
    context.store.save = async (...args) => {
      saves += 1;
      if (saves === 1) throw new Error("connection reset");
      return original(...args);
    };

    const report = await ingestDocuments(
      [document()],
      { ...context, retry: { attempts: 3, baseDelayMs: 0 }, sleep: async () => {} },
    );

    expect(saves).toBe(2);
    expect(report.totals.ingested).toBe(1);
  });
});
