import type { JobPayload } from "@dp/domain/jobs";
import { createEmbeddingService } from "@dp/gateway/embedding-service";
import { createEmbeddingGateway, embeddingSpecFor } from "@dp/gateway/embeddings";
import { createFxRateService } from "@dp/gateway/fx";
import { createOpenRouterEmbeddingTransport } from "@dp/gateway/openrouter-embeddings";
import { createEmbeddingCache } from "@dp/gateway/repositories/embedding-cache-repository";

import { corpusContentDir } from "../corpus";
import { ingestDocuments, type IngestionReport } from "../ingestion/pipeline";
import { createIngestionStore } from "../ingestion/repository";
import { derivedDocuments } from "../ingestion/sources/derived";
import { fileDocuments } from "../ingestion/sources/files";
import type { JobHandler } from "./types";

type Ingest = Extract<JobPayload, { kind: "ingest.knowledge" }>;

export function sourceDocuments(only: "derived" | "files" | null) {
  return [
    ...(only === "files" ? [] : derivedDocuments()),
    ...(only === "derived" ? [] : fileDocuments(corpusContentDir())),
  ];
}

/**
 * Embeds and stores the knowledge corpus.
 *
 * Every embedding rides the gateway: ledgered, budgeted, priced and cached by
 * content hash, so a re-run of an unchanged corpus costs nothing. A run with a
 * failure is reported as such rather than quietly partial.
 */
export const ingestKnowledge: JobHandler<Ingest> = async (payload, context, run) => {
  const env = context.env.app;
  const embeddingKey = env.OPENROUTER_API_KEY;
  if (!embeddingKey) return { status: "failed", errorCode: "no_model_key" };

  const entry = context.registry.forTier("embedding");
  if (entry.dimensions === undefined) return { status: "failed", errorCode: "no_embedding_width" };

  const spec = embeddingSpecFor("ingestion.embedding", { timeoutMs: 60_000, dimensions: entry.dimensions });
  if (!spec.ok) return { status: "failed", errorCode: "embedding_spec" };

  const report: IngestionReport = await ingestDocuments(
    sourceDocuments(payload.only),
    {
      store: createIngestionStore(context.client),
      embeddings: createEmbeddingService({
        gateway: createEmbeddingGateway({
          registry: context.registry,
          transport: createOpenRouterEmbeddingTransport({
            apiKey: embeddingKey,
            appUrl: env.APP_URL,
            appName: env.APP_NAME,
          }),
          ledger: context.accounting,
          budgets: context.accounting,
          fx: createFxRateService(context.accounting, {
            logger: run.logger,
            bootstrap: env.FX_EUR_PER_USD_BOOTSTRAP
              ? { eurPerUsd: env.FX_EUR_PER_USD_BOOTSTRAP, source: "configured" }
              : undefined,
          }),
          pricing: context.accounting,
          logger: run.logger,
        }),
        spec: spec.data,
        cache: createEmbeddingCache(context.client),
        modelId: entry.modelId,
      }),
      logger: run.logger,
    },
    { force: payload.force },
  );

  run.logger.info("ingest.finished", { ...report.totals });

  if (report.totals.failed > 0) return { status: "failed", errorCode: "documents_failed" };
  return { status: "done", detail: { ...report.totals } };
};
