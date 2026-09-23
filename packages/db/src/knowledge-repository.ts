import { z } from "zod";

import { cefrLevelSchema } from "@dp/domain/cefr";
import { ok, type RepositoryResult } from "./errors";
import { decodeInput, decodeRows } from "./result";
import type { DatabaseClient } from "./types";

const DOCUMENTS = "knowledge_documents";
const CHUNKS = "knowledge_chunks";

const knowledgeDocumentSchema = z.object({
  id: z.number().int(),
  content_hash: z.string(),
});

const knowledgeChunkSchema = z.object({
  id: z.number().int(),
  document_id: z.number().int(),
  content: z.string(),
  cefr: cefrLevelSchema.nullable(),
  mini_level: z.number().int().nullable(),
  topic: z.string().nullable(),
  content_type: z.string(),
});

export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>;

const chunkQuerySchema = z.object({
  cefr: cefrLevelSchema.optional(),
  contentType: z.string().optional(),
  miniLevelAtMost: z.number().int().min(1).max(70).optional(),
  limit: z.number().int().min(1).max(50),
});

export type ChunkQuery = z.infer<typeof chunkQuerySchema>;

export interface KnowledgeRepository {
  findDocumentByHash(
    contentHash: string,
  ): Promise<RepositoryResult<KnowledgeDocument | null>>;
  findChunks(query: ChunkQuery): Promise<RepositoryResult<KnowledgeChunk[]>>;
}

export function createKnowledgeRepository(
  client: DatabaseClient,
): KnowledgeRepository {
  return {
    async findDocumentByHash(contentHash) {
      const outcome = await client
        .from(DOCUMENTS)
        .select("id, content_hash")
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (outcome.error) {
        return decodeRows(outcome, knowledgeDocumentSchema) as never;
      }
      // Absence is the expected answer during ingestion, not a failure.
      if (outcome.data === null) return ok(null);

      const parsed = knowledgeDocumentSchema.safeParse(outcome.data);
      return parsed.success
        ? ok(parsed.data)
        : (decodeRows({ data: [outcome.data], error: null }, knowledgeDocumentSchema) as never);
    },

    async findChunks(query) {
      const input = decodeInput(query, chunkQuerySchema);
      if (!input.ok) return input;

      // Metadata and level filtering first. Similarity ranking arrives with
      // the retriever in Phase 12; filtering before ranking is what keeps an
      // off-level B1 document from outranking relevant A2 knowledge.
      let builder = client.from(CHUNKS).select("*");
      if (input.data.cefr) builder = builder.eq("cefr", input.data.cefr);
      if (input.data.contentType) {
        builder = builder.eq("content_type", input.data.contentType);
      }
      if (input.data.miniLevelAtMost !== undefined) {
        builder = builder.lte("mini_level", input.data.miniLevelAtMost);
      }

      return decodeRows(await builder.limit(input.data.limit), knowledgeChunkSchema);
    },
  };
}
