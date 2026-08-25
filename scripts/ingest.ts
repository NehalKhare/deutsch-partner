import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { createEmbeddingService } from "../lib/ai/gateway/embedding-service";
import {
  createEmbeddingGateway,
  embeddingSpecFor,
} from "../lib/ai/gateway/embeddings";
import { createFxRateService } from "../lib/ai/gateway/fx";
import { createOpenRouterEmbeddingTransport } from "../lib/ai/gateway/openrouter-embeddings";
import {
  createModelRegistry,
  registryOverridesFromEnv,
} from "../lib/ai/gateway/registry";
import { ingestDocuments, type IngestionReport } from "../lib/ingestion/pipeline";
import { derivedDocuments } from "../lib/ingestion/sources/derived";
import { fileDocuments } from "../lib/ingestion/sources/files";
import { parseEnv, requireEnvValue } from "../lib/env/schema";
import { createLogger } from "../lib/observability/logger";
import {
  createEmbeddingCache,
  createIngestionStore,
} from "../repositories/ingestion-repository";
import { createUsageAccounting } from "../repositories/usage-repository";
import type { DatabaseClient } from "../repositories/types";

/**
 * Ingests the corpus into the vector store.
 *
 * Run with: pnpm ingest [--dry-run] [--force] [--only=derived|files]
 *
 * Re-running it is the normal case, not the exceptional one. A document whose
 * cleaned body has not changed is skipped before anything is embedded, so a
 * run over an unchanged corpus costs nothing and writes nothing. `--dry-run`
 * goes one step further and reports what would be written without contacting
 * the embedding provider at all.
 */

function say(message = ""): void {
  process.stdout.write(`${message}\n`);
}

function abort(message: string): never {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const found = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

function report(outcome: IngestionReport): void {
  say();
  for (const document of outcome.documents) {
    if (document.status === "failed") {
      say(`  failed     ${document.source}`);
      say(`             ${document.error}`);
    } else if (document.status === "unchanged") {
      say(`  unchanged  ${document.source}`);
    } else {
      const cache =
        document.embedded === 0 && document.cacheHits > 0
          ? " (all cached)"
          : ` (${document.embedded} embedded, ${document.cacheHits} cached)`;
      say(`  ingested   ${document.source} — ${document.chunks} chunks${cache}`);
    }
  }

  const totals = outcome.totals;
  say();
  say(
    `  ${totals.ingested} ingested, ${totals.unchanged} unchanged, ` +
      `${totals.failed} failed`,
  );
  say(
    `  ${totals.chunks} chunks, ${totals.embedded} embedded, ` +
      `${totals.cacheHits} from cache, EUR ${totals.costEur.toFixed(6)}`,
  );
  say();
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const env = parseEnv(process.env);

  const dryRun = flag("dry-run");
  const only = option("only");

  const documents = [
    ...(only === "files" ? [] : derivedDocuments()),
    ...(only === "derived" ? [] : fileDocuments(join(process.cwd(), "content"))),
  ];

  say(`\n  ${documents.length} source documents${dryRun ? " (dry run)" : ""}`);

  const logger = createLogger({
    base: { service: "ingest", environment: env.NODE_ENV },
  });

  if (dryRun) {
    // No client, no provider, no key required. A dry run is a way to check
    // chunking and metadata on a laptop with nothing configured.
    report(
      await ingestDocuments(
        documents,
        {
          store: {
            async findDocument() {
              return null;
            },
            async save() {
              throw new Error("a dry run does not write");
            },
          },
          embeddings: {
            async embed() {
              throw new Error("a dry run does not embed");
            },
          },
          logger,
        },
        { dryRun: true },
      ),
    );
    return;
  }

  const url = requireEnvValue(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requireEnvValue(env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");
  // Embeddings ride OpenRouter like chat, and like speech: one key covers
  // every model call this product makes.
  const embeddingKey = env.OPENROUTER_API_KEY;
  if (!embeddingKey) abort("OPENROUTER_API_KEY is not set. Add it to .env.local.");

  // The repositories depend on the narrow slice of supabase-js they actually
  // use, not on the full generated client type; see repositories/types.ts.
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DatabaseClient;

  const registry = createModelRegistry(registryOverridesFromEnv(env));
  const entry = registry.forTier("embedding");
  const dimensions = entry.dimensions;

  if (dimensions === undefined) {
    abort("the embedding tier has no configured vector width");
  }

  const spec = embeddingSpecFor("ingestion.embedding", {
    timeoutMs: 60_000,
    dimensions,
  });
  if (!spec.ok) abort(`could not build an embedding spec: ${spec.detail}`);

  const accounting = createUsageAccounting(client, logger);

  const outcome = await ingestDocuments(
    documents,
    {
      store: createIngestionStore(client),
      embeddings: createEmbeddingService({
        gateway: createEmbeddingGateway({
          registry,
          transport: createOpenRouterEmbeddingTransport({
            apiKey: embeddingKey,
            appUrl: env.APP_URL,
            appName: env.APP_NAME,
          }),
          ledger: accounting,
          budgets: accounting,
          fx: createFxRateService(accounting, {
            logger,
            bootstrap: env.FX_EUR_PER_USD_BOOTSTRAP
              ? { eurPerUsd: env.FX_EUR_PER_USD_BOOTSTRAP, source: "configured" }
              : undefined,
          }),
          pricing: accounting,
          logger,
        }),
        spec: spec.data,
        cache: createEmbeddingCache(client),
        modelId: entry.modelId,
      }),
      logger,
    },
    { force: flag("force") },
  );

  report(outcome);

  // A run with a failure exits non-zero so a scheduled ingestion is visibly
  // broken rather than quietly partial.
  if (outcome.totals.failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  abort(error instanceof Error ? error.message : String(error));
});
