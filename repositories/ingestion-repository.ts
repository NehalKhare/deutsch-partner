import { z } from "zod";

import type {
  CachedEmbedding,
  EmbeddingCache,
} from "@/lib/ai/gateway/embedding-service";
import type { SourceDocument } from "@/lib/ingestion/document";
import type {
  ChunkRecord,
  IngestionStore,
  SaveResult,
  StoredDocument,
} from "@/lib/ingestion/store";
import type { DatabaseClient } from "@/repositories/types";

/**
 * The corpus, from the ingestion pipeline's side.
 *
 * Two ports over the same client: the document store and the embedding cache.
 * Both are operator-scope — the knowledge tables are readable by a learner but
 * writable only by the service role, and the cache is not readable at all —
 * so this is only ever constructed with a privileged client.
 */

const documentRowSchema = z.object({
  id: z.coerce.number().int(),
});

const chunkHashRowSchema = z.object({
  chunk_hash: z.string(),
});

const saveResultSchema = z.object({
  document_id: z.coerce.number().int(),
  created: z.boolean(),
  chunks_written: z.coerce.number().int().min(0),
  chunks_removed: z.coerce.number().int().min(0),
});

const cacheRowSchema = z.object({
  content_hash: z.string(),
  embedding: z.union([z.string(), z.array(z.number())]),
});

/**
 * pgvector accepts and returns its literal form, `[0.1,0.2]`. Rendering it
 * here rather than sending an array keeps the conversion in one place and out
 * of the SQL, which has to work against both a real vector column and the
 * text stand-in the test harness substitutes.
 */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

function fromVectorLiteral(value: string | number[]): readonly number[] {
  if (Array.isArray(value)) return value;

  return value
    .replace(/^\[|\]$/gu, "")
    .split(",")
    .filter((part) => part.trim() !== "")
    .map(Number);
}

function toChunkPayload(chunk: ChunkRecord): Record<string, unknown> {
  return {
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    chunk_hash: chunk.chunkHash,
    token_count: chunk.tokenCount,
    cefr: chunk.cefr,
    mini_level: chunk.miniLevel,
    topic: chunk.topic,
    skill: chunk.skill,
    grammar_target: chunk.grammarTarget,
    content_type: chunk.contentType,
    difficulty: chunk.difficulty,
    embedding: chunk.embedding ? toVectorLiteral(chunk.embedding) : null,
    metadata: chunk.metadata,
  };
}

function toDocumentPayload(
  document: SourceDocument,
  contentHash: string,
): Record<string, unknown> {
  return {
    source: document.source,
    title: document.title,
    content_type: document.contentType,
    language: document.language,
    cefr: document.cefr,
    license: document.license,
    attribution: document.attribution,
    content_hash: contentHash,
    metadata: document.metadata,
  };
}

export function createIngestionStore(client: DatabaseClient): IngestionStore {
  return {
    async findDocument(contentHash): Promise<StoredDocument | null> {
      const found = await client
        .from("knowledge_documents")
        .select("id")
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (found.error) throw new Error(found.error.code ?? "document_lookup_failed");
      if (found.data === null) return null;

      const document = documentRowSchema.parse(found.data);

      const chunks = await client
        .from("knowledge_chunks")
        .select("chunk_hash")
        .eq("document_id", document.id)
        .limit(2000);

      if (chunks.error) throw new Error(chunks.error.code ?? "chunk_lookup_failed");

      return {
        id: document.id,
        chunkHashes: z
          .array(chunkHashRowSchema)
          .parse(chunks.data ?? [])
          .map((row) => row.chunk_hash),
      };
    },

    async save(document, contentHash, chunks): Promise<SaveResult> {
      // One function so the document, its chunks and the removal of the chunks
      // it no longer produces all move together. A half-written document is a
      // document that answers questions from text it no longer contains.
      const outcome = await client.rpc("ingest_document", {
        p_document: toDocumentPayload(document, contentHash),
        p_chunks: chunks.map(toChunkPayload),
      });

      if (outcome.error) throw new Error(outcome.error.code ?? "ingest_failed");

      const result = saveResultSchema.parse(outcome.data);

      return {
        documentId: result.document_id,
        created: result.created,
        chunksWritten: result.chunks_written,
        chunksRemoved: result.chunks_removed,
      };
    },
  };
}

export function createEmbeddingCache(client: DatabaseClient): EmbeddingCache {
  return {
    async lookup(modelId, hashes) {
      const hits = new Map<string, readonly number[]>();
      if (hashes.length === 0) return hits;

      const outcome = await client
        .from("embedding_cache")
        .select("content_hash, embedding")
        .eq("model_id", modelId)
        .in("content_hash", hashes)
        .limit(hashes.length);

      // A cache that cannot be read is a cost, not a failure. The run
      // continues and re-embeds rather than stopping.
      if (outcome.error) return hits;

      for (const row of z.array(cacheRowSchema).catch([]).parse(outcome.data ?? [])) {
        hits.set(row.content_hash, fromVectorLiteral(row.embedding));
      }

      return hits;
    },

    async store(modelId, dimensions, entries: readonly CachedEmbedding[]) {
      if (entries.length === 0) return;

      await client.from("embedding_cache").upsert(
        entries.map((entry) => ({
          model_id: modelId,
          content_hash: entry.contentHash,
          dimensions,
          embedding: toVectorLiteral(entry.embedding),
          last_used_at: new Date().toISOString(),
        })),
        { onConflict: "model_id,content_hash" },
      );
    },
  };
}
