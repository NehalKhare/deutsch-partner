import "server-only";

import { cache } from "react";

import { billingLogger, createPriceReader } from "@/lib/api/composition";
import type { PriceList } from "@/lib/billing/offers";

/**
 * The active prices, once per request.
 *
 * billing_prices is Stripe's list as `prices:sync` last mirrored it, and the
 * only place a page learns what anything costs (billing-and-plans-spec.md
 * S7). Read at request time, so a price changed in Stripe and synced is on
 * the page at the next visit without a deploy.
 *
 * Nothing that renders a page may fail because of it. A read that fails —
 * or a deployment with no secret key to read with — is "unavailable": the
 * cards still describe the plans, the number is replaced by a way to find it,
 * and the log says why once, at warn.
 */
export const currentPrices = cache(async (): Promise<PriceList> => {
  let read;
  try {
    read = await createPriceReader().activePrices();
  } catch {
    billingLogger().warn("billing.prices_unavailable", { kind: "thrown" });
    return { status: "unavailable" };
  }

  if (!read.ok) {
    billingLogger().warn("billing.prices_unavailable", { kind: read.error.kind });
    return { status: "unavailable" };
  }
  return { status: "ready", prices: read.data };
});
