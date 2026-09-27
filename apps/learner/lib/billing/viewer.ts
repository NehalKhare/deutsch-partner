import "server-only";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { currentBilling } from "@/lib/billing/entitlement";
import { SIGNED_OUT, type PricingViewer } from "@/lib/billing/offers";

/**
 * The visitor a public page is showing plans to.
 *
 * The landing page and /pricing are the same for everybody except for which
 * door each card draws: sign up first, go straight to the order page, change
 * plan in the Customer Portal, or nothing because this is already yours. The
 * session is read from its verified claims; the plan from the learner's own
 * billing rows. Nothing about it is taken from the request.
 */
export async function pricingViewer(): Promise<PricingViewer> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) return SIGNED_OUT;

  const standing = await currentBilling(learnerId);
  return {
    signedIn: true,
    plan: standing.entitlement.plan,
    subscribed: standing.paidSubscription !== null,
    trialing: standing.trial !== null,
    trialEligible: standing.trialEligible,
  };
}
