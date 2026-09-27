import { z } from "zod";

import type { PaidPlanCode } from "./plans";

/**
 * The vocabulary of taking money, with no money in it.
 *
 * billing-and-plans-spec.md S5 to S7. Stripe's statuses and the offers this
 * application sells, as closed sets, so a webhook handler, a repository and
 * the order page cannot each spell them their own way. Amounts live in Stripe
 * and are mirrored with a fetched_at stamp; nothing here knows what anything
 * costs.
 */

/** Every status Stripe gives a subscription, and no others. */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
] as const;

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/**
 * The statuses that grant the plan. past_due is Stripe's retry window: the
 * learner has failed to pay once, not refused to, and cutting them off during
 * the retries would punish a card that expired last week.
 */
export const GRANTING_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const satisfies readonly SubscriptionStatus[];

export function isGrantingStatus(status: SubscriptionStatus): boolean {
  return (GRANTING_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

export const BILLING_INTERVALS = ["month", "year"] as const;

export const billingIntervalSchema = z.enum(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

/** The Stripe lookup keys of everything sellable (spec S7). A Price with any other key grants nothing. */
export const OFFER_KEYS = [
  "dp_plus_month",
  "dp_plus_year",
  "dp_premium_month",
  "dp_premium_year",
  "dp_pass_plus",
  "dp_pass_premium",
] as const;

export const offerKeySchema = z.enum(OFFER_KEYS);
export type OfferKey = z.infer<typeof offerKeySchema>;

export const OFFER_KINDS = ["subscription", "pass"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export interface Offer {
  readonly plan: PaidPlanCode;
  readonly kind: OfferKind;
  /** Null for a pass, which is bought once and does not renew. */
  readonly interval: BillingInterval | null;
}

export const OFFERS: Readonly<Record<OfferKey, Offer>> = Object.freeze({
  dp_plus_month: { plan: "plus", kind: "subscription", interval: "month" },
  dp_plus_year: { plan: "plus", kind: "subscription", interval: "year" },
  dp_premium_month: { plan: "premium", kind: "subscription", interval: "month" },
  dp_premium_year: { plan: "premium", kind: "subscription", interval: "year" },
  dp_pass_plus: { plan: "plus", kind: "pass", interval: null },
  dp_pass_premium: { plan: "premium", kind: "pass", interval: null },
});

/**
 * The offer a lookup key names, or null.
 *
 * Takes anything, because what it is handed came back from Stripe: a Price
 * created by hand in the Dashboard, or one with no lookup key at all, is a
 * thing to ignore and report rather than a plan to grant.
 */
export function offerFor(key: string | null | undefined): Offer | null {
  const parsed = offerKeySchema.safeParse(key);
  return parsed.success ? OFFERS[parsed.data] : null;
}

/** Two years. Longer than any pass sold, shorter than a typo in the Dashboard. */
export const PASS_DAYS_MAX = 730;

/**
 * A pass's length, from the Price's pass_days metadata. Stripe metadata is
 * always a string, so a string of digits is read; anything else — a unit
 * suffix, an exponent, a fraction — is refused rather than guessed at.
 */
export const passDaysSchema = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().min(1).max(PASS_DAYS_MAX));

/** The one trial: Premium, seven days, no card, no automatic charge (spec S6). */
export const TRIAL_PLAN = "premium" as const satisfies PaidPlanCode;
export const TRIAL_DAYS = 7;

/**
 * The version of the terms and withdrawal text shown on the order page,
 * recorded with every order. Changing either text is changing this.
 */
export const TERMS_VERSION = "2026-09-25";

/**
 * A subscription as entitlement needs it: plain data, read from our own
 * mirror of what Stripe last said, never from a request.
 */
export interface SubscriptionGrant {
  readonly planCode: PaidPlanCode;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly trialEnd: Date | null;
}

/** A pass as entitlement needs it. The window is [startsAt, endsAt). */
export interface PassGrant {
  readonly planCode: PaidPlanCode;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly revokedAt: Date | null;
}
