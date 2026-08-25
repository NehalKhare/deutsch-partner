import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { isoDate } from "../lib/ai/gateway/fx";
import { ensureDailyRate } from "../lib/ops/fx-refresh";
import { parseEnv, requireEnvValue } from "../lib/env/schema";
import { createLogger } from "../lib/observability/logger";
import { createFxRateSnapshots } from "../repositories/usage-repository";
import type { DatabaseClient } from "../repositories/types";

/**
 * Snapshots the euro rate the ledger prices in.
 *
 * Run with: pnpm fx:refresh [--force]
 *
 * Meant for a daily schedule. Every model call is converted to euro at write
 * time against the newest rate this job has recorded, and a row written when
 * the table is empty can only declare itself unpriced — which is exactly what
 * happened to every call ever made before this job existed.
 *
 * The source is asked at most once a day, so running this on an hourly cron
 * costs one database read and nothing else. `--force` asks anyway, which is
 * what the refresh control on the cost dashboard does.
 *
 * Historical rows are left alone. A call recorded as unpriced stays unpriced:
 * the ledger is append-only, its dollar figure is exact, and its stored euro
 * figure was never true. The dashboard converts those rows at the newest rate
 * for display and says that it did.
 */

function say(message = ""): void {
  process.stdout.write(`${message}\n`);
}

function abort(message: string): never {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvConfig(join(process.cwd()));
  const env = parseEnv(process.env);

  const url = requireEnvValue(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requireEnvValue(env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");

  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DatabaseClient;

  const outcome = await ensureDailyRate(
    { snapshots: createFxRateSnapshots(client), logger: createLogger() },
    { force: process.argv.includes("--force") },
  );

  say();

  if (outcome.status === "asked_today") {
    say("  the source was already read today; nothing to do (--force asks anyway)");
    say();
    return;
  }

  if (outcome.status === "unavailable") {
    abort("the exchange rate source could not be read.");
  }

  if (outcome.status === "not_stored") {
    abort(`the rate could not be stored: ${outcome.detail}`);
  }

  const { rate } = outcome;
  const today = isoDate(new Date());
  const carried =
    rate.rateDate === today
      ? ""
      : ` — today is ${today}, so calls priced now are flagged as carried forward`;

  say(`  ${rate.source} ${rate.rateDate}: ${rate.eurPerUsd} EUR per USD`);
  say(`  stored${carried}`);
  say();
}

main().catch((error: unknown) => {
  abort(error instanceof Error ? error.message : String(error));
});
