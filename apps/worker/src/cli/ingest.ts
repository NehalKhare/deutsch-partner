import { z } from "zod";

import { nullLogger } from "@dp/observability/logger";

import { sourceDocuments } from "../handlers/ingest";
import { ingestDocuments } from "../ingestion/pipeline";
import { flag, option, runNow } from "./run-now";

/**
 * Run with: pnpm ingest [--dry-run] [--only=files|derived] [--force]
 *
 * A dry run needs no client, no provider and no key: it is a way to check
 * chunking and metadata on a laptop with nothing configured.
 */
async function main(): Promise<void> {
  const only = z.enum(["derived", "files"]).nullable().parse(option("only"));

  if (flag("dry-run")) {
    const report = await ingestDocuments(
      sourceDocuments(only),
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
        logger: nullLogger,
      },
      { dryRun: true },
    );
    process.stdout.write(`\n  dry run: ${JSON.stringify(report.totals)}\n\n`);
    return;
  }

  await runNow({ kind: "ingest.knowledge", only, force: flag("force") });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
