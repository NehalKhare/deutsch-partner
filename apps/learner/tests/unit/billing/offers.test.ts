import { describe, expect, it } from "vitest";

import { TRIAL_DAYS } from "@dp/domain/billing";

import { SIGN_UP_PATH } from "@/lib/auth/routes";
import {
  SIGNED_OUT,
  cheapestPass,
  checkoutPath,
  entryHref,
  offerCatalogue,
  passCards,
  planCards,
  type PricingViewer,
} from "@/lib/billing/offers";

import { ALL_PRICES, priceRow } from "./fixtures";

/**
 * From the price mirror to what a pricing card shows and where its button
 * goes. Pure, so every combination of signed-in, plan and price state is a
 * line here rather than a page someone has to click through.
 */

const ready = offerCatalogue({ status: "ready", prices: ALL_PRICES });
const signedIn = (over: Partial<PricingViewer> = {}): PricingViewer => ({
  signedIn: true,
  plan: "free",
  subscribed: false,
  trialing: false,
  trialEligible: true,
  ...over,
});

const card = (cards: ReturnType<typeof planCards>, plan: string) => cards.find((entry) => entry.plan === plan)!;

describe("the catalogue", () => {
  it("formats each offer from its row, with VAT already in it", () => {
    expect(ready.offers.dp_plus_month).toMatchObject({ amount: "€9.99", amountMinor: 999, currency: "eur" });
    expect(ready.offers.dp_premium_year).toMatchObject({ amount: "€139.99", interval: "year" });
  });

  it("gives a yearly price its monthly equivalent, rounded up", () => {
    expect(ready.offers.dp_plus_year?.perMonth).toBe("€5.84");
    expect(ready.offers.dp_plus_month?.perMonth).toBeNull();
  });

  it("gives a pass its length", () => {
    expect(ready.offers.dp_pass_plus).toMatchObject({ passDays: 180, kind: "pass", interval: null });
  });

  it("reads one currency and ignores the rest", () => {
    const catalogue = offerCatalogue({
      status: "ready",
      prices: [priceRow("dp_plus_month", { currency: "usd", unitAmountMinor: 1099 })],
    });
    expect(catalogue.offers.dp_plus_month).toBeUndefined();
  });

  it("ignores a row Stripe no longer lists as active", () => {
    const catalogue = offerCatalogue({ status: "ready", prices: [priceRow("dp_plus_month", { active: false })] });
    expect(catalogue.offers.dp_plus_month).toBeUndefined();
  });

  it("says when the mirror could not be read, which is not the same as empty", () => {
    expect(offerCatalogue({ status: "unavailable" }).readable).toBe(false);
    expect(offerCatalogue({ status: "ready", prices: [] }).readable).toBe(true);
  });

  it("finds the cheapest pass for the 'passes from' line", () => {
    expect(cheapestPass(ready)?.offerKey).toBe("dp_pass_plus");
    expect(cheapestPass(offerCatalogue({ status: "ready", prices: [] }))).toBeNull();
  });
});

describe("where a button goes", () => {
  it("goes straight to the order page for a learner who is signed in", () => {
    expect(entryHref(signedIn(), checkoutPath("dp_plus_month"))).toBe("/billing/checkout?offer=dp_plus_month");
  });

  it("goes through sign-up for a visitor, carrying the order page along", () => {
    const href = entryHref(SIGNED_OUT, checkoutPath("dp_plus_month"));
    expect(href).toBe(`${SIGN_UP_PATH}?next=${encodeURIComponent("/billing/checkout?offer=dp_plus_month")}`);
  });
});

describe("the plan cards", () => {
  it("are Free, Plus and Premium, with Plus recommended", () => {
    const cards = planCards(ready, SIGNED_OUT);
    expect(cards.map((entry) => entry.plan)).toEqual(["free", "plus", "premium"]);
    expect(cards.filter((entry) => entry.recommended).map((entry) => entry.plan)).toEqual(["plus"]);
  });

  it("send a visitor to sign up, for Free and for a paid plan alike", () => {
    const cards = planCards(ready, SIGNED_OUT);
    expect(card(cards, "free").month.cta).toEqual({ href: SIGN_UP_PATH, label: "Start free" });
    expect(card(cards, "plus").month.cta?.href).toBe(
      `${SIGN_UP_PATH}?next=${encodeURIComponent("/billing/checkout?offer=dp_plus_month")}`,
    );
    expect(card(cards, "plus").year.cta?.href).toContain(encodeURIComponent("offer=dp_plus_year"));
  });

  it("send a signed-in learner to the order page for the interval shown", () => {
    const cards = planCards(ready, signedIn());
    expect(card(cards, "premium").month.cta).toEqual({
      href: "/billing/checkout?offer=dp_premium_month",
      label: "Choose Premium",
    });
    expect(card(cards, "premium").year.cta?.href).toBe("/billing/checkout?offer=dp_premium_year");
  });

  it("mark the learner's own plan and offer no button to buy it again", () => {
    const cards = planCards(ready, signedIn({ plan: "plus", subscribed: true, trialEligible: false }));
    expect(card(cards, "plus").current).toBe(true);
    expect(card(cards, "plus").month.cta).toBeNull();
    expect(card(cards, "free").current).toBe(false);
  });

  it("send a subscriber to Plan & billing to change plan, never to a second subscription", () => {
    const cards = planCards(ready, signedIn({ plan: "plus", subscribed: true, trialEligible: false }));
    expect(card(cards, "premium").month.cta?.href).toBe("/billing");
  });

  it("give a learner on the trial the order page for every paid plan, Premium included", () => {
    // The trial is paid for by nobody: ordering what comes after it is an
    // order, placed on the order page with its button and its consent.
    const cards = planCards(ready, signedIn({ plan: "premium", trialing: true, trialEligible: false }));

    expect(card(cards, "premium").current).toBe(true);
    expect(card(cards, "premium").month.cta).toEqual({
      href: "/billing/checkout?offer=dp_premium_month",
      label: "Keep Premium",
    });
    expect(card(cards, "plus").year.cta?.href).toBe("/billing/checkout?offer=dp_plus_year");
  });

  it("offer no Free button to a signed-in learner, who already has Free", () => {
    const cards = planCards(ready, signedIn());
    expect(card(cards, "free").month.cta).toBeNull();
    expect(card(cards, "free").current).toBe(true);
  });

  it("offer no button and no figure for a price that is not there", () => {
    const cards = planCards(offerCatalogue({ status: "ready", prices: [] }), SIGNED_OUT);
    expect(card(cards, "plus").month).toEqual({ price: null, cta: null });
  });

  it("offer the trial to a visitor and to an eligible learner, through its own page", () => {
    expect(card(planCards(ready, SIGNED_OUT), "premium").trial).toEqual({
      href: `${SIGN_UP_PATH}?next=${encodeURIComponent("/billing/trial")}`,
      label: `Try Premium free for ${TRIAL_DAYS} days`,
    });
    expect(card(planCards(ready, signedIn()), "premium").trial?.href).toBe("/billing/trial");
  });

  it("offer the trial to nobody who has used it, and on no other card", () => {
    const used = planCards(ready, signedIn({ trialEligible: false }));
    expect(card(used, "premium").trial).toBeNull();
    for (const entry of planCards(ready, SIGNED_OUT)) {
      if (entry.plan !== "premium") expect(entry.trial).toBeNull();
    }
  });

  it("offer the trial even when prices are unavailable, because a trial costs nothing", () => {
    const cards = planCards(offerCatalogue({ status: "unavailable" }), SIGNED_OUT);
    expect(card(cards, "premium").trial).not.toBeNull();
  });
});

describe("the pass cards", () => {
  it("are one per paid plan, with the length and the order page", () => {
    const passes = passCards(ready, signedIn());
    expect(passes.map((entry) => entry.plan)).toEqual(["plus", "premium"]);
    expect(passes[0]).toMatchObject({
      price: { amount: "€44.99", passDays: 180 },
      cta: { href: "/billing/checkout?offer=dp_pass_plus", label: "Buy the Plus pass" },
    });
  });

  it("have no button without a price", () => {
    const passes = passCards(offerCatalogue({ status: "ready", prices: [] }), SIGNED_OUT);
    expect(passes.every((entry) => entry.cta === null && entry.price === null)).toBe(true);
  });
});
