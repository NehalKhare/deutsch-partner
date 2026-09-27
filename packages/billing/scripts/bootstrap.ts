import { readFileSync } from "node:fs";

import { parseEnv, requireEnvValue } from "@dp/env/schema";

import { assertTestModeKey, bootstrapCatalogue } from "../src/bootstrap";
import { parseCatalogue } from "../src/catalogue";
import { createStripeClient } from "../src/stripe-provider";

/**
 * Creates the Products and Prices of a new test-mode Stripe account from
 * catalogue.json (billing-and-plans-spec.md S7), then says what it did.
 *
 * Idempotent: run it again and it creates nothing that exists. It refuses a
 * live key before building a client. Reads STRIPE_SECRET_KEY from the
 * environment, or from apps/learner/.env.local — the one deployable that
 * holds it.
 *
 * Run with: pnpm --filter @dp/billing stripe:bootstrap
 * Then:     pnpm --filter @dp/billing prices:sync
 */

function abort(message: string): never {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Only this script's key is asked for; nothing else here needs production's list.
  const env = parseEnv(process.env, { productionRequired: [] });
  const secretKey = requireEnvValue(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY");
  assertTestModeKey(secretKey);

  const parsed = parseCatalogue(JSON.parse(readFileSync(new URL("../catalogue.json", import.meta.url), "utf8")));
  if (!parsed.success) {
    abort(`catalogue.json is not valid:\n${parsed.error.issues.map((issue) => `    ${issue.path.join(".")}: ${issue.message}`).join("\n")}`);
  }

  const report = await bootstrapCatalogue(createStripeClient(secretKey), parsed.data, { secretKey });

  process.stdout.write("\n  Products\n");
  for (const product of report.products) {
    process.stdout.write(`    ${product.action.padEnd(8)} ${product.productId} (${product.plan})\n`);
  }
  process.stdout.write("\n  Prices\n");
  for (const price of report.prices) {
    const note = price.differences ? `  differs from the catalogue in: ${price.differences.join(", ")}` : "";
    process.stdout.write(`    ${price.action.padEnd(8)} ${price.lookupKey.padEnd(18)} ${price.priceId}${note}\n`);
  }
  if (report.prices.some((price) => price.action === "differs")) {
    process.stdout.write(
      "\n  A Price that differs was left as Stripe has it. Stripe is the source of truth once a Price\n" +
        "  exists: change it in the Dashboard with a new Price that takes over the lookup key.\n",
    );
  }
  process.stdout.write("\n  Next: pnpm --filter @dp/billing prices:sync\n\n");
}

main().catch((error: unknown) => {
  // A billing error's message is its code; anything else is reduced to its name.
  abort(error instanceof Error ? `${error.name}: ${error.message}` : "bootstrap failed");
});
