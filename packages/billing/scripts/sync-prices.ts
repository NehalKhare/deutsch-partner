import { createClient } from "@supabase/supabase-js";

import { createBillingAdminRepository } from "@dp/db/billing-repository";
import type { DatabaseClient } from "@dp/db/types";
import { parseEnv, requireEnvValue } from "@dp/env/schema";

import { syncPrices } from "../src/prices";
import { createStripeProvider } from "../src/stripe-provider";

/**
 * Refreshes billing_prices from Stripe's active Prices (billing-and-plans-
 * spec.md S7). The pricing page reads the mirror; this is how it learns that
 * a price changed.
 *
 * The secret-key database client, because billing_prices is operator scope:
 * RLS on and no policy. No webhook secret: this verifies no event.
 *
 * Run with: pnpm --filter @dp/billing prices:sync
 */

function abort(message: string): never {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const env = parseEnv(process.env, { productionRequired: [] });
  const stripeKey = requireEnvValue(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY");
  const url = requireEnvValue(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const databaseKey = requireEnvValue(env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");

  const database = createClient(url, databaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DatabaseClient;
  const provider = createStripeProvider({ secretKey: stripeKey, webhookSecret: null });

  const result = await syncPrices(provider, createBillingAdminRepository(database), new Date());
  if (!result.ok) abort(`Prices were not synced: ${result.code}. The mirror keeps what it had.`);

  const { upserted, deactivated, rejected, missing } = result.report;
  process.stdout.write(`\n  Mode       ${stripeKey.includes("_live_") ? "live" : "test"}\n`);
  process.stdout.write(`  Mirrored   ${upserted} price rows\n`);
  process.stdout.write(`  Retired    ${deactivated} rows Stripe no longer lists\n`);
  for (const row of rejected) {
    process.stdout.write(`  Left out   ${row.lookupKey ?? "(no lookup key)"} ${row.currency} ${row.priceId}: ${row.reason}\n`);
  }
  if (missing.length > 0) {
    process.stdout.write(`  Missing    ${missing.join(", ")} — the pricing page shows these as unavailable\n`);
  }
  process.stdout.write("\n");
}

main().catch((error: unknown) => {
  abort(error instanceof Error ? `${error.name}: ${error.message}` : "price sync failed");
});
