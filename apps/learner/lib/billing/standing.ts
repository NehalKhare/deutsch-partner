import type { LearnerBillingGrants } from "@dp/db/billing-repository";
import type { PassGrant, SubscriptionGrant } from "@dp/domain/billing";
import { resolveEntitlement, trialEligible, trialUsed, type Entitlement } from "@dp/domain/entitlement";
import { comparePlans } from "@dp/domain/plans";

/**
 * A learner's billing rows, read as a page needs them.
 *
 * Pure: the rows go in, already read, and the plan comes out by the domain's
 * rule (billing-and-plans-spec.md S5). Kept apart from the module that reads
 * them so that the order handlers can ask the same questions of the same
 * rows without a database.
 */

export interface BillingStanding {
  /** False when the rows could not be read, and everything below is the floor. */
  readonly readable: boolean;
  readonly entitlement: Entitlement;
  /**
   * The highest subscription that is granting now, whether or not it is what
   * decided the plan: a Plus subscription renewing under a Premium pass still
   * has a renewal date worth showing, and still rules out a second one.
   */
  readonly subscription: SubscriptionGrant | null;
  /**
   * The highest granting subscription that is paid for — not the trial. What
   * rules out ordering a second subscription, and what the Customer Portal
   * is for. A learner on the trial has none, and orders on the order page.
   */
  readonly paidSubscription: SubscriptionGrant | null;
  /** Premium's trial, while it runs. */
  readonly trial: SubscriptionGrant | null;
  /** The learner's passes, as read: what a new pass would stack behind. */
  readonly passes: readonly PassGrant[];
  /** A Stripe customer exists, so the Customer Portal has something to open. */
  readonly hasCustomer: boolean;
  readonly trialEligible: boolean;
  /** The trial itself was had, as opposed to the learner having subscribed without one. */
  readonly trialUsed: boolean;
}

/**
 * What a learner we could not read is treated as: Free, the floor of every
 * plan, so nobody is handed more than they paid for — and not trial-eligible,
 * because offering a trial we cannot vouch for is how one account gets two.
 */
export const UNREADABLE_STANDING: BillingStanding = {
  readable: false,
  entitlement: { plan: "free", source: "free", until: null },
  subscription: null,
  paidSubscription: null,
  trial: null,
  passes: [],
  hasCustomer: false,
  trialEligible: false,
  trialUsed: false,
};

/** Granting by the domain's own rule — grace and all — rather than a second copy of it. */
function granting(subscription: SubscriptionGrant, now: Date): boolean {
  return resolveEntitlement({ subscriptions: [subscription], passes: [], now }).source === "subscription";
}

export function standingFrom(rows: LearnerBillingGrants, now: Date): BillingStanding {
  const live = rows.subscriptions
    .filter((subscription) => granting(subscription, now))
    .sort((a, b) => comparePlans(b.planCode, a.planCode));

  return {
    readable: true,
    entitlement: resolveEntitlement({
      subscriptions: rows.subscriptions,
      passes: rows.passes,
      comps: rows.comps,
      now,
    }),
    subscription: live[0] ?? null,
    paidSubscription: live.find((subscription) => subscription.status !== "trialing") ?? null,
    trial: live.find((subscription) => subscription.status === "trialing") ?? null,
    passes: rows.passes,
    hasCustomer: rows.customerId !== null,
    trialEligible: trialEligible(rows.subscriptions),
    trialUsed: trialUsed(rows.subscriptions),
  };
}
