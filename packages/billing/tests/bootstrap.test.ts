import { describe, expect, it, vi } from "vitest";

import { BootstrapRefusedError, assertTestModeKey, bootstrapCatalogue, type StripeBootstrapClient } from "../src/bootstrap";
import { catalogueSchema, type Catalogue } from "../src/catalogue";
import { BillingProviderError } from "../src/errors";
import { stripePrice } from "./support/stripe-objects";

/**
 * Setting up a new Stripe account from catalogue.json (spec S7).
 *
 * It creates the two Products and six Prices, and is safe to run again:
 * anything already there under its id or lookup key is kept, and a Price
 * whose amount differs from the catalogue is reported, never changed —
 * Stripe is where prices live once they exist. It never runs against a live
 * key.
 */

const TEST_KEY = "sk_test_51AbcDEFghiJKLmno";

const CATALOGUE: Catalogue = catalogueSchema.parse({
  currency: "eur",
  taxBehavior: "inclusive",
  products: {
    plus: { id: "dp_plus", name: "Deutsch Partner Plus" },
    premium: { id: "dp_premium", name: "Deutsch Partner Premium" },
  },
  prices: [
    { lookupKey: "dp_plus_month", amountMinor: 999 },
    { lookupKey: "dp_plus_year", amountMinor: 6999 },
    { lookupKey: "dp_premium_month", amountMinor: 1999 },
    { lookupKey: "dp_premium_year", amountMinor: 13999 },
    { lookupKey: "dp_pass_plus", amountMinor: 4499, passDays: 180 },
    { lookupKey: "dp_pass_premium", amountMinor: 4999, passDays: 90 },
  ],
});

const notFound = () =>
  Object.assign(new Error("No such product: 'dp_plus'"), {
    type: "StripeInvalidRequestError",
    statusCode: 404,
    code: "resource_missing",
  });

function freshAccount() {
  let created = 0;
  return {
    products: {
      retrieve: vi.fn(async (_id: string): Promise<unknown> => Promise.reject(notFound())),
      create: vi.fn(async (params: { id?: string }) => ({ id: params.id, object: "product", active: true })),
    },
    prices: {
      list: vi.fn(async () => ({ object: "list", data: [] as unknown[], has_more: false })),
      create: vi.fn(async (params: { lookup_key?: string }) => {
        created += 1;
        return stripePrice({ id: `price_New${created}`, lookup_key: params.lookup_key });
      }),
    },
  };
}

const client = (fake: ReturnType<typeof freshAccount>) => fake as unknown as StripeBootstrapClient;

describe("assertTestModeKey", () => {
  it.each(["sk_test_51Abc", "rk_test_51Abc"])("accepts a test-mode key (%s)", (key) => {
    expect(() => assertTestModeKey(key)).not.toThrow();
  });

  it.each(["sk_live_51Abc", "rk_live_51Abc", "pk_test_51Abc", "", "whsec_abc"])("refuses %s, without echoing it", (key) => {
    expect(() => assertTestModeKey(key)).toThrow(BootstrapRefusedError);
    try {
      assertTestModeKey(key);
    } catch (error) {
      if (key.length > 0) expect((error as Error).message).not.toContain(key);
    }
  });
});

describe("bootstrapCatalogue", () => {
  it("refuses a live key before making any call", async () => {
    const fake = freshAccount();

    await expect(bootstrapCatalogue(client(fake), CATALOGUE, { secretKey: "sk_live_51Abc" })).rejects.toThrow(
      BootstrapRefusedError,
    );
    expect(fake.products.retrieve).not.toHaveBeenCalled();
    expect(fake.prices.list).not.toHaveBeenCalled();
  });

  it("creates the two products under their own ids, naming the plan and nothing else", async () => {
    const fake = freshAccount();

    const report = await bootstrapCatalogue(client(fake), CATALOGUE, { secretKey: TEST_KEY });

    expect(fake.products.create.mock.calls.map(([params]) => params)).toEqual([
      { id: "dp_plus", name: "Deutsch Partner Plus", metadata: { plan_code: "plus" } },
      { id: "dp_premium", name: "Deutsch Partner Premium", metadata: { plan_code: "premium" } },
    ]);
    expect(report.products).toEqual([
      { plan: "plus", productId: "dp_plus", action: "created" },
      { plan: "premium", productId: "dp_premium", action: "created" },
    ]);
  });

  it("creates the six prices, VAT inclusive, under their lookup keys", async () => {
    const fake = freshAccount();

    await bootstrapCatalogue(client(fake), CATALOGUE, { secretKey: TEST_KEY });

    const sent = fake.prices.create.mock.calls.map(([params]) => params as Record<string, unknown>);
    expect(sent).toHaveLength(6);
    expect(sent.find((params) => params.lookup_key === "dp_premium_year")).toEqual({
      product: "dp_premium",
      currency: "eur",
      unit_amount: 13999,
      tax_behavior: "inclusive",
      lookup_key: "dp_premium_year",
      nickname: "dp_premium_year",
      recurring: { interval: "year", interval_count: 1 },
      metadata: { plan_code: "premium" },
    });
    expect(sent.find((params) => params.lookup_key === "dp_pass_plus")).toEqual({
      product: "dp_plus",
      currency: "eur",
      unit_amount: 4499,
      tax_behavior: "inclusive",
      lookup_key: "dp_pass_plus",
      nickname: "dp_pass_plus",
      metadata: { plan_code: "plus", pass_days: "180" },
    });
  });

  it("looks for what exists by lookup key before creating anything", async () => {
    const fake = freshAccount();

    await bootstrapCatalogue(client(fake), CATALOGUE, { secretKey: TEST_KEY });

    expect(fake.prices.list).toHaveBeenCalledWith({
      lookup_keys: CATALOGUE.prices.map((price) => price.lookupKey),
      limit: 100,
      expand: ["data.currency_options"],
    });
  });

  it("creates nothing on a second run", async () => {
    const fake = freshAccount();
    fake.products.retrieve.mockImplementation(async () => ({ id: "dp_plus", object: "product", active: true }));
    fake.prices.list.mockImplementation(async () => ({
      object: "list",
      data: CATALOGUE.prices.map((price, index) => {
        const offerPlan = price.lookupKey.includes("premium") ? "premium" : "plus";
        const pass = price.passDays !== undefined;
        const yearly = price.lookupKey.endsWith("_year");
        return stripePrice({
          id: `price_Existing${index}`,
          lookup_key: price.lookupKey,
          product: offerPlan === "plus" ? "dp_plus" : "dp_premium",
          unit_amount: price.amountMinor,
          recurring: pass ? null : { interval: yearly ? "year" : "month", interval_count: 1 },
          metadata: pass ? { plan_code: offerPlan, pass_days: String(price.passDays) } : { plan_code: offerPlan },
        });
      }),
      has_more: false,
    }));

    const report = await bootstrapCatalogue(client(fake), CATALOGUE, { secretKey: TEST_KEY });

    expect(fake.products.create).not.toHaveBeenCalled();
    expect(fake.prices.create).not.toHaveBeenCalled();
    expect(report.prices.every((price) => price.action === "kept")).toBe(true);
  });

  it("reports a price whose amount differs, and leaves it as Stripe has it", async () => {
    const fake = freshAccount();
    fake.prices.list.mockImplementation(async () => ({
      object: "list",
      data: [stripePrice({ id: "price_Old", lookup_key: "dp_plus_month", product: "dp_plus", unit_amount: 899 })],
      has_more: false,
    }));

    const report = await bootstrapCatalogue(client(fake), CATALOGUE, { secretKey: TEST_KEY });

    expect(report.prices.find((price) => price.lookupKey === "dp_plus_month")).toEqual({
      lookupKey: "dp_plus_month",
      priceId: "price_Old",
      action: "differs",
      differences: ["unit_amount"],
    });
    expect(fake.prices.create.mock.calls.map(([params]) => (params as { lookup_key: string }).lookup_key)).not.toContain(
      "dp_plus_month",
    );
  });

  it("passes further currencies through as currency options", async () => {
    const fake = freshAccount();
    const catalogue = catalogueSchema.parse({
      ...CATALOGUE,
      prices: CATALOGUE.prices.map((price) =>
        price.lookupKey === "dp_plus_month" ? { ...price, currencyOptions: { usd: 1099 } } : price,
      ),
    });

    await bootstrapCatalogue(client(fake), catalogue, { secretKey: TEST_KEY });

    const sent = fake.prices.create.mock.calls
      .map(([params]) => params as Record<string, unknown>)
      .find((params) => params.lookup_key === "dp_plus_month");
    expect(sent?.currency_options).toEqual({ usd: { unit_amount: 1099, tax_behavior: "inclusive" } });
  });

  it("stops on a failure it cannot read as 'not there yet'", async () => {
    const fake = freshAccount();
    fake.products.retrieve.mockImplementation(async () =>
      Promise.reject(Object.assign(new Error("Invalid API Key provided: sk_test_***"), { type: "StripeAuthenticationError" })),
    );

    await expect(bootstrapCatalogue(client(fake), CATALOGUE, { secretKey: TEST_KEY })).rejects.toThrow(BillingProviderError);
    expect(fake.products.create).not.toHaveBeenCalled();
  });
});
