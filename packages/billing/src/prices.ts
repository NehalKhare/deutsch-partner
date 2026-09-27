import {
  billingPriceInputSchema,
  type BillingAdminRepository,
  type BillingPriceInput,
} from "@dp/db/billing-repository";
import { OFFER_KEYS, OFFERS, offerKeySchema, passDaysSchema, type OfferKey } from "@dp/domain/billing";

import { isBillingProviderError } from "./errors";
import type { BillingProvider, NormalizedPrice } from "./provider";

/**
 * Refreshing the price mirror from Stripe (billing-and-plans-spec.md S7).
 *
 * Stripe holds every price; billing_prices is what the pricing page reads,
 * one row per Price and currency, stamped with when it was read. A price in
 * code is a figure that goes quietly stale, so there is none here: this
 * module only decides which of Stripe's Prices the page may show.
 *
 * It may show a Price that is what its lookup key says it is — the plan,
 * the billing interval (one month or one year, not three), a pass's length —
 * and that is VAT inclusive, because the page says "incl. VAT" beside every
 * figure and an EU consumer is shown what they pay. Anything else is left
 * out and reported with a reason, and the rest is still written: the
 * database refuses a batch with one bad row in it, and one mistyped Price in
 * the Dashboard should not take the whole page down.
 */

export interface RejectedPrice {
  readonly priceId: string;
  readonly currency: string;
  readonly lookupKey: string | null;
  readonly reason:
    | "no_unit_amount"
    | "not_tax_inclusive"
    | "offer_mismatch"
    | "invalid_pass_days"
    | "invalid_price";
}

export interface PriceSyncReport {
  readonly upserted: number;
  /** Rows Stripe no longer lists, kept and marked inactive. */
  readonly deactivated: number;
  readonly rejected: readonly RejectedPrice[];
  /** Offers with no Price the page can show, in any currency. */
  readonly missing: readonly OfferKey[];
}

export type PriceSyncResult =
  | { readonly ok: true; readonly report: PriceSyncReport }
  | { readonly ok: false; readonly code: string };

type Judged = { readonly ok: true; readonly row: BillingPriceInput } | { readonly ok: false; readonly reason: RejectedPrice["reason"] };

function judge(price: NormalizedPrice): Judged {
  const reject = (reason: RejectedPrice["reason"]): Judged => ({ ok: false, reason });

  if (price.unitAmountMinor === null) return reject("no_unit_amount");
  if (price.taxBehavior !== "inclusive") return reject("not_tax_inclusive");

  const key = offerKeySchema.safeParse(price.lookupKey);
  if (!key.success) return reject("offer_mismatch");
  const offer = OFFERS[key.data];

  // A subscription offer is one Price billed every one month or one year;
  // a pass is a one-off Price. Anything else under the key is not the offer.
  const kind = price.recurring === null ? "pass" : "subscription";
  if (kind !== offer.kind) return reject("offer_mismatch");
  if (price.recurring !== null && (price.recurring.intervalCount !== 1 || price.recurring.interval !== offer.interval)) {
    return reject("offer_mismatch");
  }
  // The lookup key names the plan; the metadata must agree with it.
  if (price.planCode !== offer.plan) return reject("offer_mismatch");

  let passDays: number | null = null;
  if (offer.kind === "pass") {
    const days = passDaysSchema.safeParse(price.passDays);
    if (!days.success) return reject("invalid_pass_days");
    passDays = days.data;
  }

  const row = billingPriceInputSchema.safeParse({
    stripePriceId: price.priceId,
    currency: price.currency,
    lookupKey: key.data,
    planCode: offer.plan,
    kind: offer.kind,
    interval: offer.interval,
    passDays,
    unitAmountMinor: price.unitAmountMinor,
    taxBehavior: "inclusive",
  });
  return row.success ? { ok: true, row: row.data } : reject("invalid_price");
}

export async function syncPrices(
  provider: Pick<BillingProvider, "listPrices">,
  repo: Pick<BillingAdminRepository, "replacePrices">,
  now: Date,
): Promise<PriceSyncResult> {
  let listed: readonly NormalizedPrice[];
  try {
    listed = await provider.listPrices(OFFER_KEYS);
  } catch (error) {
    // Nothing is written from a failed read: the mirror keeps what it had.
    return { ok: false, code: isBillingProviderError(error) ? error.code : "stripe_unavailable" };
  }

  const accepted: BillingPriceInput[] = [];
  const rejected: RejectedPrice[] = [];
  for (const price of listed) {
    const judged = judge(price);
    if (judged.ok) accepted.push(judged.row);
    else rejected.push({ priceId: price.priceId, currency: price.currency, lookupKey: price.lookupKey, reason: judged.reason });
  }

  const replaced = await repo.replacePrices(accepted, now);
  if (!replaced.ok) return { ok: false, code: `store_${replaced.error.kind}` };

  const offered = new Set(accepted.map((row) => row.lookupKey));
  return {
    ok: true,
    report: {
      upserted: replaced.data.upserted,
      deactivated: replaced.data.deactivated,
      rejected,
      missing: OFFER_KEYS.filter((key) => !offered.has(key)),
    },
  };
}
