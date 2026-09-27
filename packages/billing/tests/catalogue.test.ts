import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OFFER_KEYS, OFFERS } from "@dp/domain/billing";

import { catalogueSchema, parseCatalogue } from "../src/catalogue";

/**
 * catalogue.json: the amounts a new Stripe account's Prices are created
 * with (spec S7). Integer cents, euro, VAT inclusive, one entry per offer —
 * and, as spec S9 requires of the starting values, each paid plan's annual
 * price must leave more than that plan's monthly euro bound once VAT and
 * Stripe's fee are taken out, so no learner is served at a loss.
 */

const CATALOGUE_FILE = fileURLToPath(new URL("../catalogue.json", import.meta.url));
const BILLING_MIGRATION = fileURLToPath(
  new URL("../../db/supabase/migrations/20260927100000_billing.sql", import.meta.url),
);

const committed = () => JSON.parse(readFileSync(CATALOGUE_FILE, "utf8")) as unknown;

describe("the committed catalogue", () => {
  it("parses", () => {
    expect(parseCatalogue(committed()).success).toBe(true);
  });

  it("prices every offer once, and nothing else", () => {
    const catalogue = catalogueSchema.parse(committed());

    expect(catalogue.prices.map((price) => price.lookupKey).sort()).toEqual([...OFFER_KEYS].sort());
  });

  it("is in euro, VAT inclusive, in whole cents", () => {
    const catalogue = catalogueSchema.parse(committed());

    expect(catalogue.currency).toBe("eur");
    expect(catalogue.taxBehavior).toBe("inclusive");
    for (const price of catalogue.prices) expect(Number.isInteger(price.amountMinor), price.lookupKey).toBe(true);
  });

  it("gives a pass, and only a pass, a length", () => {
    const catalogue = catalogueSchema.parse(committed());

    for (const price of catalogue.prices) {
      expect(price.passDays !== undefined, price.lookupKey).toBe(OFFERS[price.lookupKey].kind === "pass");
    }
  });

  it("names a product for each paid plan", () => {
    const catalogue = catalogueSchema.parse(committed());

    expect(catalogue.products.plus.id).toMatch(/^dp_/);
    expect(catalogue.products.premium.id).toMatch(/^dp_/);
  });

  it("leaves each annual plan more a month than its starting euro bound", () => {
    // Spec S9: the bound is sized against the annual price, the smaller
    // monthly revenue. German VAT and Stripe's standard EEA card fee are the
    // conservative case; the bounds are the seeded starting values.
    const catalogue = catalogueSchema.parse(committed());
    const sql = readFileSync(BILLING_MIGRATION, "utf8");
    const boundOf = (plan: string) => {
      const match = new RegExp(`'per_user_monthly',\\s*'plan:${plan}',\\s*([0-9.]+)`).exec(sql);
      if (!match) throw new Error(`no seeded bound for ${plan}`);
      return Number(match[1]) * 100;
    };
    const VAT_DIVISOR = 1.19;
    const CARD_FEE_SHARE = 0.015;
    const CARD_FEE_FIXED_MINOR = 25;

    for (const [plan, key] of [
      ["plus", "dp_plus_year"],
      ["premium", "dp_premium_year"],
    ] as const) {
      const yearly = catalogue.prices.find((price) => price.lookupKey === key)!.amountMinor;
      const netMonthly = (yearly / VAT_DIVISOR - (yearly * CARD_FEE_SHARE + CARD_FEE_FIXED_MINOR)) / 12;

      expect(netMonthly, plan).toBeGreaterThan(boundOf(plan));
    }
  });
});

describe("what the schema refuses", () => {
  const valid = () => structuredClone(committed()) as { prices: Array<Record<string, unknown>>; [key: string]: unknown };

  it("an offer priced twice", () => {
    const catalogue = valid();
    catalogue.prices.push({ ...catalogue.prices[0] });

    expect(parseCatalogue(catalogue).success).toBe(false);
  });

  it("an offer left out", () => {
    const catalogue = valid();
    catalogue.prices.pop();

    expect(parseCatalogue(catalogue).success).toBe(false);
  });

  it("an amount in euros rather than cents", () => {
    const catalogue = valid();
    catalogue.prices[0] = { ...catalogue.prices[0], amountMinor: 9.99 };

    expect(parseCatalogue(catalogue).success).toBe(false);
  });

  it("a pass with no length, and a subscription with one", () => {
    const pass = valid();
    const passIndex = pass.prices.findIndex((price) => price.lookupKey === "dp_pass_plus");
    delete pass.prices[passIndex]!.passDays;
    expect(parseCatalogue(pass).success).toBe(false);

    const subscription = valid();
    subscription.prices[0] = { ...subscription.prices[0], passDays: 30 };
    expect(parseCatalogue(subscription).success).toBe(false);
  });

  it("a currency option repeating the base currency", () => {
    const catalogue = valid();
    catalogue.prices[0] = { ...catalogue.prices[0], currencyOptions: { eur: 999 } };

    expect(parseCatalogue(catalogue).success).toBe(false);
  });

  it("accepts a further currency beside the base one", () => {
    const catalogue = valid();
    catalogue.prices[0] = { ...catalogue.prices[0], currencyOptions: { usd: 1099, gbp: 899 } };

    expect(parseCatalogue(catalogue).success).toBe(true);
  });

  it("a price that is not VAT inclusive", () => {
    expect(parseCatalogue({ ...valid(), taxBehavior: "exclusive" }).success).toBe(false);
  });
});
