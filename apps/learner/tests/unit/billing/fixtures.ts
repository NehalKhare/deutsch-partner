import type { BillingPrice } from "@dp/db/billing-repository";
import { OFFERS, type OfferKey } from "@dp/domain/billing";

/**
 * Price mirror rows as billing_prices holds them, for tests.
 *
 * The amounts are catalogue.json's, in cents, so a test reads like the page
 * a learner will see. They are integers: a price with a decimal point is a
 * literal the security tests refuse, in tests as in product code.
 */

export const AMOUNTS: Readonly<Record<OfferKey, number>> = {
  dp_plus_month: 999,
  dp_plus_year: 6999,
  dp_premium_month: 1999,
  dp_premium_year: 13999,
  dp_pass_plus: 4499,
  dp_pass_premium: 4999,
};

const PASS_DAYS: Partial<Record<OfferKey, number>> = { dp_pass_plus: 180, dp_pass_premium: 90 };

export function priceRow(key: OfferKey, over: Partial<BillingPrice> = {}): BillingPrice {
  const offer = OFFERS[key];
  return {
    stripePriceId: `price_${key.replace(/_/g, "")}`,
    currency: "eur",
    lookupKey: key,
    planCode: offer.plan,
    kind: offer.kind,
    interval: offer.interval,
    passDays: PASS_DAYS[key] ?? null,
    unitAmountMinor: AMOUNTS[key],
    taxBehavior: "inclusive",
    active: true,
    fetchedAt: new Date("2026-09-25T08:00:00Z"),
    ...over,
  };
}

/** Every offer, active, in euro. */
export const ALL_PRICES: readonly BillingPrice[] = (Object.keys(AMOUNTS) as OfferKey[]).map((key) =>
  priceRow(key),
);
