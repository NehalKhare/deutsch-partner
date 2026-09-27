import type { BillingPrice } from "@dp/db/billing-repository";
import {
  OFFER_KEYS,
  OFFERS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  type BillingInterval,
  type OfferKey,
  type OfferKind,
} from "@dp/domain/billing";
import { PAID_PLAN_CODES, PLAN_CODES, type PaidPlanCode, type PlanCode } from "@dp/domain/plans";

import { SIGN_UP_PATH } from "@/lib/auth/routes";
import { PLAN_TAGLINES, RECOMMENDED_PLAN, planHighlights, planName } from "@/lib/billing/copy";
import { formatMinor, monthlyEquivalentMinor, yearlySavingPercent } from "@/lib/billing/format";

/**
 * From the price mirror to what a pricing card shows and where its button
 * goes.
 *
 * Pure, and made of plain data, so the server builds it once per request and
 * hands it to the Client Components that draw the cards — they never import
 * the module that reads the database, and never see a Stripe id. The price
 * itself is whatever billing_prices holds for the offer; when it holds
 * nothing, a card says so and has no button, and a figure is never invented
 * (billing-and-plans-spec.md S7).
 */

/** The currency a price is shown in until a visitor can choose one. Nothing else here assumes euro. */
export const DEFAULT_CURRENCY = "eur";

export const BILLING_PATH = "/billing";
export const CHECKOUT_PATH = "/billing/checkout";
export const TRIAL_PATH = "/billing/trial";
export const PRICING_PATH = "/pricing";
/** Where the terms an order is placed under live. A stub until B10 (spec S11). */
export const TERMS_PATH = "/legal/terms";

/** What reading the mirror came to: its active rows, or that it could not be read. */
export type PriceList =
  | { readonly status: "ready"; readonly prices: readonly BillingPrice[] }
  | { readonly status: "unavailable" };

/** One offer's price, ready to print. VAT inclusive, as the mirror holds it. */
export interface PriceView {
  readonly offerKey: OfferKey;
  readonly plan: PaidPlanCode;
  readonly kind: OfferKind;
  readonly interval: BillingInterval | null;
  readonly amountMinor: number;
  readonly currency: string;
  /** "€9.99" */
  readonly amount: string;
  /** For a yearly price: a month of it, rounded up. Always shown with the yearly total. */
  readonly perMonth: string | null;
  readonly passDays: number | null;
}

export interface OfferCatalogue {
  /** False when the mirror could not be read. Empty-but-readable is "being set up". */
  readonly readable: boolean;
  readonly currency: string;
  readonly offers: Readonly<Partial<Record<OfferKey, PriceView>>>;
}

function viewOf(row: BillingPrice): PriceView {
  const offer = OFFERS[row.lookupKey];
  return {
    offerKey: row.lookupKey,
    plan: offer.plan,
    kind: offer.kind,
    interval: offer.interval,
    amountMinor: row.unitAmountMinor,
    currency: row.currency,
    amount: formatMinor(row.unitAmountMinor, row.currency),
    perMonth:
      offer.interval === "year"
        ? formatMinor(monthlyEquivalentMinor(row.unitAmountMinor), row.currency)
        : null,
    passDays: row.passDays,
  };
}

export function offerCatalogue(list: PriceList, currency: string = DEFAULT_CURRENCY): OfferCatalogue {
  if (list.status === "unavailable") return { readable: false, currency, offers: {} };

  const offers: Partial<Record<OfferKey, PriceView>> = {};
  for (const row of list.prices) {
    // The mirror keeps inactive rows so history is not lost; only what
    // Stripe sells today is shown. One row per offer and currency is the
    // table's own constraint, so the first is the only.
    if (!row.active || row.currency !== currency || offers[row.lookupKey]) continue;
    offers[row.lookupKey] = viewOf(row);
  }
  return { readable: true, currency, offers };
}

export function subscriptionOfferKey(plan: PaidPlanCode, interval: BillingInterval): OfferKey {
  return OFFER_KEYS.find(
    (key) => OFFERS[key].plan === plan && OFFERS[key].kind === "subscription" && OFFERS[key].interval === interval,
  )!;
}

export function passOfferKey(plan: PaidPlanCode): OfferKey {
  return OFFER_KEYS.find((key) => OFFERS[key].plan === plan && OFFERS[key].kind === "pass")!;
}

/**
 * The Price a trial subscribes to: Premium's monthly one. The trial never
 * charges it — with no card on file the subscription cancels itself when the
 * trial ends — but a subscription needs a Price to exist.
 */
export const TRIAL_OFFER: OfferKey = subscriptionOfferKey(TRIAL_PLAN, "month");

/** The whole percent a plan's yearly price saves over twelve months of its monthly one. */
export function yearlySaving(catalogue: OfferCatalogue, plan: PaidPlanCode): number | null {
  const month = catalogue.offers[subscriptionOfferKey(plan, "month")];
  const year = catalogue.offers[subscriptionOfferKey(plan, "year")];
  if (!month || !year) return null;
  return yearlySavingPercent(month.amountMinor, year.amountMinor);
}

/** For "Prefer to pay once? Passes from …". */
export function cheapestPass(catalogue: OfferCatalogue): PriceView | null {
  const passes = PAID_PLAN_CODES.map((plan) => catalogue.offers[passOfferKey(plan)]).filter(
    (price): price is PriceView => price !== undefined,
  );
  return passes.reduce<PriceView | null>(
    (cheapest, price) => (cheapest === null || price.amountMinor < cheapest.amountMinor ? price : cheapest),
    null,
  );
}

// --- who is looking -------------------------------------------------------------

/**
 * The visitor, as far as a pricing card needs to know them. Resolved on the
 * server from their own billing rows (lib/billing/viewer.ts); the card never
 * decides anything about entitlement, it only chooses which door to draw.
 */
export interface PricingViewer {
  readonly signedIn: boolean;
  /** The plan they have now. Null when signed out. */
  readonly plan: PlanCode | null;
  /** A paid subscription currently grants it: changing plan is the Customer Portal's job. */
  readonly subscribed: boolean;
  /**
   * On Premium's trial. The trial is paid for by nobody, so it is no reason
   * to withhold an order button — ordering what comes after it happens on
   * the order page, like any other order (spec S6).
   */
  readonly trialing: boolean;
  readonly trialEligible: boolean;
}

export const SIGNED_OUT: PricingViewer = {
  signedIn: false,
  plan: null,
  subscribed: false,
  trialing: false,
  trialEligible: true,
};

export interface Cta {
  readonly href: string;
  readonly label: string;
}

export function checkoutPath(offerKey: OfferKey): string {
  return `${CHECKOUT_PATH}?offer=${offerKey}`;
}

/**
 * Where a button sends this viewer: straight there when signed in, and
 * through sign-up otherwise, carrying the destination so a plan picked before
 * an account existed is the plan ordered after it does.
 */
export function entryHref(viewer: PricingViewer, path: string): string {
  return viewer.signedIn ? path : `${SIGN_UP_PATH}?next=${encodeURIComponent(path)}`;
}

// --- the cards --------------------------------------------------------------------

export interface IntervalOffer {
  /** Null for Free, and for a paid plan whose price is not in the mirror. */
  readonly price: PriceView | null;
  readonly cta: Cta | null;
}

export interface PlanCardView {
  readonly plan: PlanCode;
  readonly name: string;
  readonly tagline: string;
  readonly highlights: readonly string[];
  readonly recommended: boolean;
  /** The viewer's own plan. */
  readonly current: boolean;
  readonly month: IntervalOffer;
  readonly year: IntervalOffer;
  readonly trial: Cta | null;
}

function paidOffer(
  catalogue: OfferCatalogue,
  viewer: PricingViewer,
  plan: PaidPlanCode,
  interval: BillingInterval,
): IntervalOffer {
  const key = subscriptionOfferKey(plan, interval);
  const price = catalogue.offers[key] ?? null;
  // No price, no button: an order page for a price nobody can see is an
  // order nobody can place lawfully.
  if (price === null) return { price, cta: null };
  // A second subscription is not how a subscriber changes plan. The Customer
  // Portal prorates; two subscriptions would bill twice.
  if (viewer.subscribed && viewer.plan !== plan) {
    return { price, cta: { href: BILLING_PATH, label: "Change on Plan & billing" } };
  }
  // The plan already held needs no button — unless it is held only by the
  // trial, which ends by itself: keeping it is an order like any other.
  if (viewer.plan === plan) {
    return viewer.trialing && !viewer.subscribed
      ? { price, cta: { href: checkoutPath(key), label: `Keep ${planName(plan)}` } }
      : { price, cta: null };
  }
  return { price, cta: { href: entryHref(viewer, checkoutPath(key)), label: `Choose ${planName(plan)}` } };
}

function trialFor(viewer: PricingViewer, plan: PlanCode): Cta | null {
  if (plan !== TRIAL_PLAN || !viewer.trialEligible || viewer.plan === TRIAL_PLAN) return null;
  return { href: entryHref(viewer, TRIAL_PATH), label: `Try ${planName(plan)} free for ${TRIAL_DAYS} days` };
}

export function planCards(catalogue: OfferCatalogue, viewer: PricingViewer): readonly PlanCardView[] {
  return PLAN_CODES.map((plan) => {
    const base = {
      plan,
      name: planName(plan),
      tagline: PLAN_TAGLINES[plan],
      highlights: planHighlights(plan),
      recommended: plan === RECOMMENDED_PLAN,
      current: viewer.plan === plan,
      trial: trialFor(viewer, plan),
    };

    if (plan === "free") {
      // A signed-in learner has Free already; there is nothing to press.
      const free: IntervalOffer = {
        price: null,
        cta: viewer.signedIn ? null : { href: SIGN_UP_PATH, label: "Start free" },
      };
      return { ...base, month: free, year: free };
    }

    return {
      ...base,
      month: paidOffer(catalogue, viewer, plan, "month"),
      year: paidOffer(catalogue, viewer, plan, "year"),
    };
  });
}

export interface PassCardView {
  readonly plan: PaidPlanCode;
  readonly name: string;
  readonly price: PriceView | null;
  readonly cta: Cta | null;
}

export function passCards(catalogue: OfferCatalogue, viewer: PricingViewer): readonly PassCardView[] {
  return PAID_PLAN_CODES.map((plan) => {
    const key = passOfferKey(plan);
    const price = catalogue.offers[key] ?? null;
    return {
      plan,
      name: planName(plan),
      price,
      cta: price === null ? null : { href: entryHref(viewer, checkoutPath(key)), label: `Buy the ${planName(plan)} pass` },
    };
  });
}
