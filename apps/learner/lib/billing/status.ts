import { planName } from "@/lib/billing/copy";
import { formatBillingDate } from "@/lib/billing/format";
import type { BillingStanding } from "@/lib/billing/standing";

/**
 * What a learner has, and until when, in one line — and what they should
 * know about it.
 *
 * Settings and Plan & billing both show it, so it is said once. A renewal,
 * an end and a trial's end are different promises: "renews on" is a charge
 * coming, "ends on" is access stopping, and writing one as the other is
 * either a surprise bill or a surprise lockout.
 */

export function planStatusLine(standing: BillingStanding): string {
  if (!standing.readable) return "Your plan could not be read just now.";

  const { entitlement, subscription } = standing;
  const name = planName(entitlement.plan);

  if (entitlement.source === "free") return "Free, with daily limits and no card.";

  if (entitlement.source === "pass") {
    return entitlement.until ? `${name} pass · until ${formatBillingDate(entitlement.until)}` : `${name} pass`;
  }

  if (subscription?.status === "trialing") {
    const end = subscription.trialEnd ?? subscription.currentPeriodEnd;
    return end ? `${name} trial · ends on ${formatBillingDate(end)}` : `${name} trial`;
  }

  const periodEnd = subscription?.currentPeriodEnd ?? entitlement.until;
  if (!periodEnd) return name;
  return subscription?.cancelAtPeriodEnd
    ? `${name} · ends on ${formatBillingDate(periodEnd)} and will not renew`
    : `${name} · renews on ${formatBillingDate(periodEnd)}`;
}

export interface PlanNotice {
  /** A warning asks for something to be done; information only explains. */
  readonly tone: "warning" | "info";
  readonly text: string;
}

/** Things worth saying beside the status line. Empty when all is well. */
export function planNotices(standing: BillingStanding): readonly PlanNotice[] {
  const subscription = standing.subscription;
  if (!standing.readable || subscription === null) return [];

  if (subscription.status === "past_due") {
    return [
      {
        tone: "warning",
        text:
          "Your last payment did not go through. Your plan carries on while Stripe tries " +
          "again; to change the card or account it uses, open Manage billing.",
      },
    ];
  }
  if (subscription.status === "trialing") {
    // What carries on is whatever else the learner holds: a plan they have
    // already ordered, or Free.
    const after = standing.paidSubscription;
    return [
      {
        tone: "info",
        text:
          "The trial ends by itself and nothing is charged. " +
          (after
            ? `When it ends, your ${planName(after.planCode)} subscription carries on.`
            : "When it ends, Free carries on unless you choose a plan."),
      },
    ];
  }
  return [];
}
