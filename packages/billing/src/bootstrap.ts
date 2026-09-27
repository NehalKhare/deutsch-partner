import type Stripe from "stripe";
import { z } from "zod";

import { OFFERS, type OfferKey } from "@dp/domain/billing";
import { PAID_PLAN_CODES, type PaidPlanCode } from "@dp/domain/plans";

import type { Catalogue, CataloguePrice } from "./catalogue";
import { BillingProviderError, billingErrorFrom } from "./errors";
import { stripeWire } from "./stripe-provider";

/**
 * Creating the Products and Prices of a new Stripe account from
 * catalogue.json (billing-and-plans-spec.md S7). Run by
 * `pnpm --filter @dp/billing stripe:bootstrap`.
 *
 * Safe to run again: a Product is found by its fixed id and a Price by its
 * lookup key, and whatever exists is kept. A Price whose amount (or anything
 * else) differs from the catalogue is reported and left alone. Once a Price
 * exists Stripe is where it lives; changing one is a new Price in the
 * Dashboard that takes over the lookup key, then `prices:sync`.
 *
 * It refuses a live key before making any call. A test account is set up
 * from a file; a live one is set up by a person, deliberately.
 */

export class BootstrapRefusedError extends Error {
  constructor() {
    // The key is never quoted: this message reaches a terminal and CI logs.
    super("stripe:bootstrap runs against a test-mode key (sk_test_… or rk_test_…) only");
    this.name = "BootstrapRefusedError";
  }
}

export function assertTestModeKey(secretKey: string): void {
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey)) throw new BootstrapRefusedError();
}

/** The slice of the SDK the bootstrap calls, shaped as StripeClient is. */
export interface StripeBootstrapClient {
  readonly products: {
    retrieve(id: string): Promise<unknown>;
    create(params: Stripe.ProductCreateParams): Promise<unknown>;
  };
  readonly prices: {
    list(params: Stripe.PriceListParams): Promise<unknown>;
    create(params: Stripe.PriceCreateParams): Promise<unknown>;
  };
}

export interface BootstrapReport {
  readonly products: ReadonlyArray<{ plan: PaidPlanCode; productId: string; action: "created" | "kept" }>;
  readonly prices: ReadonlyArray<{
    lookupKey: OfferKey;
    priceId: string;
    action: "created" | "kept" | "differs";
    /** Which of the catalogue's fields the existing Price does not match. */
    differences?: readonly string[];
  }>;
}

const productWire = z.object({ id: z.string() });
const existingPrice = stripeWire.price.extend({
  product: z.union([z.string(), z.object({ id: z.string() })]).transform((value) => (typeof value === "string" ? value : value.id)),
});
const existingList = z.object({ data: z.array(existingPrice), has_more: z.boolean() });

async function call<T>(request: () => Promise<unknown>, schema: z.ZodType<T>): Promise<T> {
  let response: unknown;
  try {
    response = await request();
  } catch (error) {
    throw billingErrorFrom(error);
  }
  const parsed = schema.safeParse(response);
  if (!parsed.success) throw new BillingProviderError("stripe_invalid_response");
  return parsed.data;
}

function metadataFor(price: CataloguePrice): Record<string, string> {
  const offer = OFFERS[price.lookupKey];
  return price.passDays === undefined
    ? { plan_code: offer.plan }
    : { plan_code: offer.plan, pass_days: String(price.passDays) };
}

function differences(
  existing: z.infer<typeof existingPrice>,
  wanted: CataloguePrice,
  productId: string,
  catalogue: Catalogue,
): string[] {
  const offer = OFFERS[wanted.lookupKey];
  const found: string[] = [];
  if (existing.product !== productId) found.push("product");
  if (existing.currency !== catalogue.currency) found.push("currency");
  if (existing.unit_amount !== wanted.amountMinor) found.push("unit_amount");
  if (existing.tax_behavior !== catalogue.taxBehavior) found.push("tax_behavior");

  const recurring = existing.recurring;
  const recurringMatches =
    offer.kind === "pass"
      ? recurring === null
      : recurring !== null && recurring.interval === offer.interval && recurring.interval_count === 1;
  if (!recurringMatches) found.push("recurring");

  const metadata = metadataFor(wanted);
  if (existing.metadata.plan_code !== metadata.plan_code) found.push("metadata.plan_code");
  if ((existing.metadata.pass_days ?? undefined) !== metadata.pass_days) found.push("metadata.pass_days");

  for (const [currency, amount] of Object.entries(wanted.currencyOptions ?? {})) {
    if (existing.currency_options?.[currency]?.unit_amount !== amount) found.push(`currency_options.${currency}`);
  }
  return found;
}

export async function bootstrapCatalogue(
  client: StripeBootstrapClient,
  catalogue: Catalogue,
  options: { readonly secretKey: string },
): Promise<BootstrapReport> {
  assertTestModeKey(options.secretKey);

  const products: Array<BootstrapReport["products"][number]> = [];
  for (const plan of PAID_PLAN_CODES) {
    const { id, name } = catalogue.products[plan];
    try {
      await call(() => client.products.retrieve(id), productWire);
      products.push({ plan, productId: id, action: "kept" });
    } catch (error) {
      if (!(error instanceof BillingProviderError) || error.code !== "stripe_not_found") throw error;
      await call(() => client.products.create({ id, name, metadata: { plan_code: plan } }), productWire);
      products.push({ plan, productId: id, action: "created" });
    }
  }

  const existing = await call(
    () =>
      client.prices.list({
        lookup_keys: catalogue.prices.map((price) => price.lookupKey),
        limit: 100,
        expand: ["data.currency_options"],
      }),
    existingList,
  );

  const prices: Array<BootstrapReport["prices"][number]> = [];
  for (const wanted of catalogue.prices) {
    const offer = OFFERS[wanted.lookupKey];
    const productId = catalogue.products[offer.plan].id;
    const found = existing.data.find((price) => price.lookup_key === wanted.lookupKey);

    if (found !== undefined) {
      const differ = differences(found, wanted, productId, catalogue);
      prices.push(
        differ.length === 0
          ? { lookupKey: wanted.lookupKey, priceId: found.id, action: "kept" }
          : { lookupKey: wanted.lookupKey, priceId: found.id, action: "differs", differences: differ },
      );
      continue;
    }

    const params: Stripe.PriceCreateParams = {
      product: productId,
      currency: catalogue.currency,
      unit_amount: wanted.amountMinor,
      tax_behavior: catalogue.taxBehavior,
      lookup_key: wanted.lookupKey,
      nickname: wanted.lookupKey,
      metadata: metadataFor(wanted),
    };
    if (offer.kind === "subscription" && offer.interval !== null) {
      params.recurring = { interval: offer.interval, interval_count: 1 };
    }
    if (wanted.currencyOptions !== undefined) {
      params.currency_options = Object.fromEntries(
        Object.entries(wanted.currencyOptions).map(([currency, amount]) => [
          currency,
          { unit_amount: amount, tax_behavior: catalogue.taxBehavior },
        ]),
      );
    }

    const created = await call(() => client.prices.create(params), productWire);
    prices.push({ lookupKey: wanted.lookupKey, priceId: created.id, action: "created" });
  }

  return { products, prices };
}
