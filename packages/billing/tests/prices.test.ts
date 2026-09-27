import { beforeEach, describe, expect, it } from "vitest";

import { OFFER_KEYS } from "@dp/domain/billing";

import { createMockBillingProvider, type MockBillingProvider } from "../src/mock";
import { syncPrices } from "../src/prices";
import type { NormalizedPrice } from "../src/provider";
import { createMemoryBillingStore, type MemoryBillingStore } from "../src/testing/memory-store";

/**
 * Mirroring Stripe's prices into billing_prices (spec S7).
 *
 * Stripe is the source of truth. The mirror holds what Stripe lists, one row
 * per price and currency, stamped with when it was read — and only what
 * matches the offer its lookup key names, VAT inclusive, so the pricing page
 * never shows a figure that is not what a learner would pay.
 */

const NOW = new Date("2026-09-25T12:00:00Z");

let provider: MockBillingProvider;
let store: MemoryBillingStore;

function price(over: Partial<NormalizedPrice> = {}): NormalizedPrice {
  return {
    priceId: "price_PlusMonth",
    lookupKey: "dp_plus_month",
    planCode: "plus",
    passDays: null,
    currency: "eur",
    unitAmountMinor: 999,
    taxBehavior: "inclusive",
    recurring: { interval: "month", intervalCount: 1 },
    ...over,
  };
}

/** One valid Price per offer, as the bootstrap creates them. */
function catalogue(): NormalizedPrice[] {
  return [
    price(),
    price({ priceId: "price_PlusYear", lookupKey: "dp_plus_year", unitAmountMinor: 6999, recurring: { interval: "year", intervalCount: 1 } }),
    price({ priceId: "price_PremiumMonth", lookupKey: "dp_premium_month", planCode: "premium", unitAmountMinor: 1999 }),
    price({
      priceId: "price_PremiumYear",
      lookupKey: "dp_premium_year",
      planCode: "premium",
      unitAmountMinor: 13999,
      recurring: { interval: "year", intervalCount: 1 },
    }),
    price({ priceId: "price_PassPlus", lookupKey: "dp_pass_plus", passDays: "180", unitAmountMinor: 4499, recurring: null }),
    price({
      priceId: "price_PassPremium",
      lookupKey: "dp_pass_premium",
      planCode: "premium",
      passDays: "90",
      unitAmountMinor: 4999,
      recurring: null,
    }),
  ];
}

beforeEach(() => {
  provider = createMockBillingProvider();
  store = createMemoryBillingStore();
});

describe("syncPrices", () => {
  it("asks Stripe for exactly the six offers", async () => {
    provider.setPrices(catalogue());

    await syncPrices(provider, store, NOW);

    expect(provider.calls).toEqual([{ method: "listPrices", input: [...OFFER_KEYS] }]);
  });

  it("mirrors every offer, stamped with when it was read", async () => {
    provider.setPrices(catalogue());

    const result = await syncPrices(provider, store, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report).toMatchObject({ upserted: 6, deactivated: 0, rejected: [], missing: [] });
    const rows = store.snapshot().prices;
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.active && row.fetchedAt.getTime() === NOW.getTime())).toBe(true);
    expect(rows.find((row) => row.lookupKey === "dp_pass_plus")).toMatchObject({
      stripePriceId: "price_PassPlus",
      planCode: "plus",
      kind: "pass",
      interval: null,
      passDays: 180,
      unitAmountMinor: 4499,
      taxBehavior: "inclusive",
    });
    expect(rows.find((row) => row.lookupKey === "dp_premium_year")).toMatchObject({
      kind: "subscription",
      interval: "year",
      passDays: null,
    });
  });

  it("keeps one row per currency Stripe offers the price in", async () => {
    provider.setPrices([price(), price({ currency: "usd", unitAmountMinor: 1099 })]);

    const result = await syncPrices(provider, store, NOW);

    expect(result.ok && result.report.upserted).toBe(2);
    expect(store.snapshot().prices.map((row) => row.currency).sort()).toEqual(["eur", "usd"]);
  });

  it("reports the offers Stripe has no price for, rather than inventing one", async () => {
    provider.setPrices([price()]);

    const result = await syncPrices(provider, store, NOW);

    expect(result.ok && result.report.missing).toEqual([
      "dp_plus_year",
      "dp_premium_month",
      "dp_premium_year",
      "dp_pass_plus",
      "dp_pass_premium",
    ]);
  });

  it.each([
    ["not tax inclusive", price({ taxBehavior: "exclusive" }), "not_tax_inclusive"],
    ["with no tax behaviour", price({ taxBehavior: null }), "not_tax_inclusive"],
    ["with no flat amount", price({ unitAmountMinor: null }), "no_unit_amount"],
    ["billed every three months under a monthly key", price({ recurring: { interval: "month", intervalCount: 3 } }), "offer_mismatch"],
    ["billed weekly", price({ recurring: { interval: "week", intervalCount: 1 } }), "offer_mismatch"],
    ["yearly under a monthly key", price({ recurring: { interval: "year", intervalCount: 1 } }), "offer_mismatch"],
    ["one-off under a subscription key", price({ recurring: null }), "offer_mismatch"],
    ["Premium's metadata under Plus's key", price({ planCode: "premium" }), "offer_mismatch"],
    ["with no plan in its metadata", price({ planCode: null }), "offer_mismatch"],
    [
      "a pass with no length",
      price({ priceId: "price_PassPlus", lookupKey: "dp_pass_plus", recurring: null, passDays: null }),
      "invalid_pass_days",
    ],
    [
      "a pass with a length in words",
      price({ priceId: "price_PassPlus", lookupKey: "dp_pass_plus", recurring: null, passDays: "six months" }),
      "invalid_pass_days",
    ],
    ["in a currency that is not one", price({ currency: "EURO" }), "invalid_price"],
  ])("leaves out a price %s, and says why", async (_label, offending, reason) => {
    provider.setPrices([offending]);

    const result = await syncPrices(provider, store, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.rejected).toEqual([
      { priceId: offending.priceId, currency: offending.currency, lookupKey: offending.lookupKey, reason },
    ]);
    expect(store.snapshot().prices).toEqual([]);
  });

  it("writes the good prices when one is bad, where the database would refuse the batch", async () => {
    provider.setPrices([...catalogue(), price({ priceId: "price_Bad", currency: "usd", taxBehavior: "exclusive" })]);

    const result = await syncPrices(provider, store, NOW);

    expect(result.ok && result.report.upserted).toBe(6);
    expect(result.ok && result.report.rejected.map((row) => row.reason)).toEqual(["not_tax_inclusive"]);
  });

  it("marks a price Stripe stopped listing inactive", async () => {
    provider.setPrices(catalogue());
    await syncPrices(provider, store, NOW);

    // The monthly Plus price was replaced: a new Price took over the lookup key.
    provider.setPrices([price({ priceId: "price_PlusMonth2", unitAmountMinor: 1099 }), ...catalogue().slice(1)]);
    const later = new Date(NOW.getTime() + 60_000);
    const result = await syncPrices(provider, store, later);

    expect(result.ok && result.report.deactivated).toBe(1);
    const old = store.snapshot().prices.find((row) => row.stripePriceId === "price_PlusMonth");
    expect(old).toMatchObject({ active: false, fetchedAt: later });
    const active = (await store.activePrices()).ok ? store.snapshot().prices.filter((row) => row.active) : [];
    expect(active.find((row) => row.lookupKey === "dp_plus_month")?.stripePriceId).toBe("price_PlusMonth2");
  });

  it("empties the mirror when Stripe lists nothing, so the page says prices are unavailable", async () => {
    provider.setPrices(catalogue());
    await syncPrices(provider, store, NOW);

    provider.setPrices([]);
    const result = await syncPrices(provider, store, NOW);

    expect(result.ok && result.report.deactivated).toBe(6);
    expect(store.snapshot().prices.filter((row) => row.active)).toEqual([]);
  });

  it("writes nothing when Stripe cannot be read, and says why with a code", async () => {
    provider.setPrices(catalogue());
    await syncPrices(provider, store, NOW);
    provider.failWith("listPrices", "stripe_authentication");

    const result = await syncPrices(provider, store, NOW);

    expect(result).toEqual({ ok: false, code: "stripe_authentication" });
    expect(store.snapshot().prices.filter((row) => row.active)).toHaveLength(6);
  });

  it("reports a store failure with a code", async () => {
    provider.setPrices(catalogue());
    store.failWith("replacePrices", "unavailable");

    expect(await syncPrices(provider, store, NOW)).toEqual({ ok: false, code: "store_unavailable" });
  });
});
