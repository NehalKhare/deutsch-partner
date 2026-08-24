import {
  gatewayOk,
  type GatewayResult,
} from "@/lib/ai/gateway/errors";
import type {
  EmbeddingCallSpec,
  EmbeddingContext,
  EmbeddingGateway,
} from "@/lib/ai/gateway/embeddings";
import { contentHash } from "@/lib/content/hash";

/**
 * Embedding with a content-addressed cache in front.
 *
 * Re-embedding text that has not changed is the easiest cost in the system to
 * remove entirely, and ingestion is where it would otherwise be paid over and
 * over: a source file with one edited paragraph re-embeds every paragraph
 * unless something remembers the others.
 *
 * The cache is keyed by the hash of the exact text together with the model
 * that embedded it. A model change is a miss rather than a stale hit, because
 * two models' vectors are not comparable and mixing them poisons every
 * similarity score that follows.
 */

export interface CachedEmbedding {
  readonly contentHash: string;
  readonly embedding: readonly number[];
}

export interface EmbeddingCache {
  lookup(
    modelId: string,
    hashes: readonly string[],
  ): Promise<ReadonlyMap<string, readonly number[]>>;
  store(
    modelId: string,
    dimensions: number,
    entries: readonly CachedEmbedding[],
  ): Promise<void>;
}

export interface EmbeddedText {
  readonly text: string;
  readonly contentHash: string;
  readonly embedding: readonly number[];
  readonly cached: boolean;
}

export interface EmbeddingRun {
  readonly embedded: readonly EmbeddedText[];
  readonly cacheHits: number;
  readonly embeddedCount: number;
  readonly costEur: number;
}

export interface EmbeddingService {
  embed(
    texts: readonly string[],
    context: EmbeddingContext,
  ): Promise<GatewayResult<EmbeddingRun>>;
}

export interface EmbeddingServiceDeps {
  readonly gateway: EmbeddingGateway;
  readonly spec: EmbeddingCallSpec;
  readonly cache?: EmbeddingCache;
  readonly modelId: string;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export function createEmbeddingService(deps: EmbeddingServiceDeps): EmbeddingService {
  return {
    async embed(texts, context) {
      if (texts.length === 0) {
        return gatewayOk({ embedded: [], cacheHits: 0, embeddedCount: 0, costEur: 0 });
      }

      const hashes = texts.map(contentHash);
      const cached = deps.cache
        ? await deps.cache.lookup(deps.modelId, [...new Set(hashes)])
        : new Map<string, readonly number[]>();

      // Deduplicated before dispatch: the same sentence appearing in two
      // documents is one embedding, not two.
      const missing = [...new Set(hashes.filter((hash) => !cached.has(hash)))];
      const textByHash = new Map(hashes.map((hash, index) => [hash, texts[index]]));

      const fresh = new Map<string, readonly number[]>();
      let costEur = 0;

      for (const batch of batches(missing, deps.spec.maxBatchSize)) {
        const outcome = await deps.gateway.embed(
          deps.spec,
          batch.map((hash) => textByHash.get(hash) as string),
          context,
        );

        // A failed batch fails the run. Returning partial vectors would let a
        // caller store some chunks embedded and some not, and a chunk with no
        // vector is invisible to retrieval without being visibly missing.
        if (!outcome.ok) return outcome;

        costEur += outcome.data.costEur;
        batch.forEach((hash, index) => fresh.set(hash, outcome.data.vectors[index]));
      }

      if (deps.cache && fresh.size > 0) {
        await deps.cache.store(
          deps.modelId,
          deps.spec.dimensions,
          [...fresh].map(([hash, embedding]) => ({ contentHash: hash, embedding })),
        );
      }

      return gatewayOk({
        embedded: texts.map((text, index) => {
          const hash = hashes[index];
          const hit = cached.get(hash);
          return {
            text,
            contentHash: hash,
            embedding: hit ?? (fresh.get(hash) as readonly number[]),
            cached: hit !== undefined,
          };
        }),
        cacheHits: hashes.filter((hash) => cached.has(hash)).length,
        embeddedCount: fresh.size,
        costEur,
      });
    },
  };
}
