import { z } from "zod";

import type {
  CachedEmbedding,
  EmbeddingCache,
} from "../embedding-service";
import type { DatabaseClient } from "@dp/db/types";

/**
 * The embedding cache, from the gateway's side.
 *
 * Operator-scope: the table is readable by nobody but the service role, so
 * this is only ever constructed with a privileged client. It holds vectors of
 * public corpus text and public queries, never learner rows.
 */

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
