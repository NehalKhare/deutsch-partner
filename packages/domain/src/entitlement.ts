import { isGrantingStatus, type PassGrant, type SubscriptionGrant } from "./billing";
import { PLAN_CATALOGUE, type PaidPlanCode, type PlanCode } from "./plans";

/**
 * Which plan a learner has, decided from rows already read.
 *
 * billing-and-plans-spec.md S5. Pure, so it is tested without a database, and
 * so the only inputs are the learner's own billing rows — never a request
 * body, a header, a cookie or a client claim. The highest-ranked current
 * grant wins; with none, the learner is on free.
 */

/**
 * How long a renewing subscription keeps granting after the period Stripe
 * last told us about has ended.
 *
 * Renewal is announced by webhook, and a webhook can be late, retried or lost.
 * Without a grace, a learner who has just been charged would drop to free in
 * the minutes between the period ending and the event arriving. With an
 * unbounded one, a single missed customer.subscription.deleted would grant the
 * plan forever. Three days covers Stripe's first retries and a weekend
 * incident, and is short enough that a missed cancellation costs at most that.
 *
 * Not applied to a subscription set to cancel at the period end: it will not
 * renew, so there is no late renewal to wait for, and the spec says it grants
 * "until it ends". Nor to a trial, for the same reason: the only trial sold
 * collects no card and cannot convert (spec S6), so its end is its end.
 */
export const SUBSCRIPTION_GRACE_MS = 3 * 86_400_000;

export type EntitlementSource = "free" | "subscription" | "pass";

export interface Entitlement {
  readonly plan: PlanCode;
  readonly source: EntitlementSource;
  /** When the granting row ends, as far as we know. Null for free, or an unknown end. */
  readonly until: Date | null;
}

export interface EntitlementInput {
  readonly subscriptions: readonly SubscriptionGrant[];
  readonly passes: readonly PassGrant[];
  readonly now: Date;
}

interface Candidate {
  readonly plan: PaidPlanCode;
  readonly source: "subscription" | "pass";
  readonly until: Date | null;
}

function subscriptionGrants(subscription: SubscriptionGrant, now: Date): boolean {
  if (!isGrantingStatus(subscription.status)) return false;
  if (subscription.currentPeriodEnd === null) return true;

  const renews = !subscription.cancelAtPeriodEnd && subscription.status !== "trialing";
  const grace = renews ? SUBSCRIPTION_GRACE_MS : 0;
  return subscription.currentPeriodEnd.getTime() + grace > now.getTime();
}

function passGrants(pass: PassGrant, now: Date): boolean {
  return (
    pass.revokedAt === null &&
    pass.startsAt.getTime() <= now.getTime() &&
    now.getTime() < pass.endsAt.getTime()
  );
}

/** An unknown end has not ended, so it outlasts any known one. */
const endOf = (until: Date | null): number =>
  until === null ? Number.POSITIVE_INFINITY : until.getTime();

function better(a: Candidate, b: Candidate): Candidate {
  const rank = PLAN_CATALOGUE[a.plan].rank - PLAN_CATALOGUE[b.plan].rank;
  if (rank !== 0) return rank > 0 ? a : b;
  return endOf(b.until) > endOf(a.until) ? b : a;
}

export function resolveEntitlement({ subscriptions, passes, now }: EntitlementInput): Entitlement {
  const candidates: Candidate[] = [
    ...subscriptions
      .filter((subscription) => subscriptionGrants(subscription, now))
      .map((subscription) => ({
        plan: subscription.planCode,
        source: "subscription" as const,
        until: subscription.currentPeriodEnd,
      })),
    ...passes
      .filter((pass) => passGrants(pass, now))
      .map((pass) => ({ plan: pass.planCode, source: "pass" as const, until: pass.endsAt })),
  ];

  if (candidates.length === 0) return { plan: "free", source: "free", until: null };

  const winner = candidates.reduce(better);
  return { plan: winner.plan, source: winner.source, until: winner.until };
}

/**
 * One trial per learner, ever. Any subscription row at all — a trial that ran
 * out, one cancelled, one that never completed — has used it.
 */
export function trialEligible(subscriptions: readonly SubscriptionGrant[]): boolean {
  return subscriptions.length === 0;
}

/**
 * Whether the learner has had the trial itself, as opposed to having
 * subscribed without one. Both rule a trial out; only this one is true to
 * say as "you have had your trial".
 */
export function trialUsed(subscriptions: readonly SubscriptionGrant[]): boolean {
  return subscriptions.some((subscription) => subscription.trialEnd !== null);
}

/**
 * Where a newly bought pass begins.
 *
 * Passes of the same plan stack rather than overlap: a learner who buys a
 * second Plus pass while the first has sixty days left gets their sixty days
 * and then the new pass, not two passes running side by side. A pass of a
 * different plan starts now; the higher plan wins while both run.
 */
export function nextPassStart(
  passes: readonly PassGrant[],
  plan: PaidPlanCode,
  now: Date,
): Date {
  const latestEnd = passes
    .filter((pass) => pass.planCode === plan && pass.revokedAt === null)
    .reduce((latest, pass) => Math.max(latest, pass.endsAt.getTime()), now.getTime());

  return new Date(latestEnd);
}
