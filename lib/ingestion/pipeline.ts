import { estimateTokens } from "@/lib/ai/prompts/tokens";
import type { EmbeddingService } from "@/lib/ai/gateway/embedding-service";
import { contentHash } from "@/lib/content/hash";
import { chunkText } from "@/lib/ingestion/chunk";
import {
  documentHash,
  prepareBody,
  sourceDocumentSchema,
  type PreparedChunk,
  type PreparedDocument,
  type SourceDocumentInput,
} from "@/lib/ingestion/document";
import { withRetry } from "@/lib/ingestion/retry";
import type { ChunkRecord, IngestionStore } from "@/lib/ingestion/store";
import { nullLogger, type Logger } from "@/lib/observability/logger";

/**
 * The ingestion pipeline: load, clean, normalise, metadata, chunk, embed,
 * upsert.
 *
 * The property the whole thing is built around is that running it twice does
 * nothing the second time. A document is keyed by the hash of its cleaned
 * body, a chunk by the hash of its own text, and if every chunk hash already
 * matches, the run skips the document before it embeds anything — which is
 * also the cheapest thing it can do, since embedding is the only part that
 * costs money.
 *
 * A failure is reported, not thrown. One bad source out of forty should leave
 * the other thirty-nine ingested and name the one that failed.
 */

export type DocumentStatus = "ingested" | "unchanged" | "failed";

export interface DocumentOutcome {
  readonly source: string;
  readonly title: string;
  readonly status: DocumentStatus;
  readonly documentId: number | null;
  readonly chunks: number;
  readonly chunksRemoved: number;
  readonly cacheHits: number;
  readonly embedded: number;
  readonly costEur: number;
  /** A short reason. Never a stack trace and never the document's own text. */
  readonly error: string | null;
}

export interface IngestionReport {
  readonly documents: readonly DocumentOutcome[];
  readonly totals: {
    readonly ingested: number;
    readonly unchanged: number;
    readonly failed: number;
    readonly chunks: number;
    readonly embedded: number;
    readonly cacheHits: number;
    readonly costEur: number;
  };
}

export interface IngestionDeps {
  readonly store: IngestionStore;
  readonly embeddings: EmbeddingService;
  readonly logger?: Logger;
  readonly retry?: { readonly attempts: number; readonly baseDelayMs: number };
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface IngestionOptions {
  /** Assemble and report, write nothing. Costs nothing and embeds nothing. */
  readonly dryRun?: boolean;
  /** Re-embed and rewrite even where the hashes say nothing changed. */
  readonly force?: boolean;
  readonly requestId?: string | null;
}

/** Everything but the identity, so a caller can inspect before writing. */
export function prepareDocument(input: SourceDocumentInput): PreparedDocument {
  const document = sourceDocumentSchema.parse(input);
  const body = prepareBody(document.body);
  const pieces = chunkText(body, document.contentType);

  const seen = new Set<string>();
  const chunks: PreparedChunk[] = [];

  for (const content of pieces) {
    const hash = contentHash(content);
    // The same text twice in one document is one chunk. Storing it twice would
    // collide on the per-document uniqueness constraint anyway, and the second
    // write would silently replace the first.
    if (seen.has(hash)) continue;
    seen.add(hash);

    chunks.push({
      index: chunks.length,
      content,
      chunkHash: hash,
      tokenCount: estimateTokens(content),
    });
  }

  return {
    document,
    body,
    contentHash: documentHash(document.source, body),
    chunks,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

export async function ingestDocuments(
  inputs: readonly SourceDocumentInput[],
  deps: IngestionDeps,
  options: IngestionOptions = {},
): Promise<IngestionReport> {
  const logger = deps.logger ?? nullLogger;
  const retry = deps.retry ?? { attempts: 3, baseDelayMs: 250 };
  const outcomes: DocumentOutcome[] = [];

  for (const input of inputs) {
    // Enough of the document to name it in a failure report even when the
    // validation that would give us the rest is what failed.
    const label = {
      source: String((input as { source?: unknown }).source ?? "unknown"),
      title: String((input as { title?: unknown }).title ?? "untitled"),
    };

    try {
      const prepared = prepareDocument(input);

      if (prepared.chunks.length === 0) {
        throw new Error("document produced no chunks");
      }

      const existing = await deps.store.findDocument(prepared.contentHash);
      const hashes = prepared.chunks.map((chunk) => chunk.chunkHash);

      if (!options.force && existing && sameSet(existing.chunkHashes, hashes)) {
        // Nothing changed. Skipped before embedding, which is the only step
        // that costs anything.
        outcomes.push({
          ...label,
          status: "unchanged",
          documentId: existing.id,
          chunks: prepared.chunks.length,
          chunksRemoved: 0,
          cacheHits: 0,
          embedded: 0,
          costEur: 0,
          error: null,
        });
        continue;
      }

      if (options.dryRun) {
        outcomes.push({
          ...label,
          status: "ingested",
          documentId: existing?.id ?? null,
          chunks: prepared.chunks.length,
          chunksRemoved: 0,
          cacheHits: 0,
          embedded: 0,
          costEur: 0,
          error: null,
        });
        continue;
      }

      const embedded = await withRetry(
        async () => {
          const outcome = await deps.embeddings.embed(
            prepared.chunks.map((chunk) => chunk.content),
            { requestId: options.requestId ?? null },
          );
          if (!outcome.ok) throw new Error(`${outcome.failure}: ${outcome.detail}`);
          return outcome.data;
        },
        {
          ...retry,
          sleep: deps.sleep,
          // A ceiling denial or a malformed spec fails the same way every
          // time. Retrying it only makes the report slower.
          isRetryable: (error) =>
            !/ceiling_denied|invalid_spec|budget_denied/.test(shortReason(error)),
          onRetry: (attempt, error) =>
            logger.warn("ingest.retry", {
              source: label.source,
              attempt,
              errorCode: shortReason(error),
            }),
        },
      );

      const records: ChunkRecord[] = prepared.chunks.map((chunk, index) => ({
        chunkIndex: chunk.index,
        content: chunk.content,
        chunkHash: chunk.chunkHash,
        tokenCount: chunk.tokenCount,
        cefr: prepared.document.cefr,
        miniLevel: prepared.document.miniLevel,
        topic: prepared.document.topic,
        skill: prepared.document.skill,
        grammarTarget: prepared.document.grammarTarget,
        contentType: prepared.document.contentType,
        difficulty: prepared.document.difficulty,
        embedding: embedded.embedded[index].embedding,
        metadata: prepared.document.metadata,
      }));

      const saved = await withRetry(
        () => deps.store.save(prepared.document, prepared.contentHash, records),
        { ...retry, sleep: deps.sleep, onRetry: (attempt, error) =>
            logger.warn("ingest.retry", {
              source: label.source,
              attempt,
              errorCode: shortReason(error),
            }),
        },
      );

      outcomes.push({
        ...label,
        status: "ingested",
        documentId: saved.documentId,
        chunks: saved.chunksWritten,
        chunksRemoved: saved.chunksRemoved,
        cacheHits: embedded.cacheHits,
        embedded: embedded.embeddedCount,
        costEur: embedded.costEur,
        error: null,
      });
    } catch (error) {
      // One bad source does not end the run. It is named, and the rest
      // continue: an ingestion that stops at the first failure is one that
      // takes forty runs to fix forty documents.
      logger.error("ingest.document_failed", {
        source: label.source,
        errorCode: shortReason(error),
      });

      outcomes.push({
        ...label,
        status: "failed",
        documentId: null,
        chunks: 0,
        chunksRemoved: 0,
        cacheHits: 0,
        embedded: 0,
        costEur: 0,
        error: shortReason(error),
      });
    }
  }

  const sum = (pick: (outcome: DocumentOutcome) => number) =>
    outcomes.reduce((total, outcome) => total + pick(outcome), 0);

  return {
    documents: outcomes,
    totals: {
      ingested: outcomes.filter((outcome) => outcome.status === "ingested").length,
      unchanged: outcomes.filter((outcome) => outcome.status === "unchanged").length,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
      chunks: sum((outcome) => outcome.chunks),
      embedded: sum((outcome) => outcome.embedded),
      cacheHits: sum((outcome) => outcome.cacheHits),
      costEur: sum((outcome) => outcome.costEur),
    },
  };
}
