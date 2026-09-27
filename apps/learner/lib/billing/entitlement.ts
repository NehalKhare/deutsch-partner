import "server-only";

import { cache } from "react";

import type { Entitlement } from "@dp/domain/entitlement";
import type { PlanCode } from "@dp/domain/plans";

import { billingLogger, createLearnerBilling } from "@/lib/api/composition";
import { UNREADABLE_STANDING, standingFrom, type BillingStanding } from "@/lib/billing/standing";

export { standingFrom, type BillingStanding } from "@/lib/billing/standing";

/**
 * Which plan the signed-in learner has, once per request.
 *
 * billing-and-plans-spec.md S5. The rows are the learner's own, read through
 * their RLS client — never a request body, a header, a cookie or anything the
 * browser sent — and resolved by the domain's pure rule. This module only
 * reads and remembers: the webhook is the one writer.
 *
 * A failed read is Free, and says it failed: a subscriber whose rows could
 * not be read is shown "we could not read your plan", not "you have no plan".
 */

/**
 * React's per-request memo, keyed on the learner id: the shell, the page and
 * (with B6) the route all ask, and one read answers them.
 */
export const currentBilling = cache(async (learnerId: string): Promise<BillingStanding> => {
  let read;
  try {
    read = await (await createLearnerBilling()).grantsFor(learnerId);
  } catch {
    billingLogger().warn("billing.entitlement_unreadable", { kind: "thrown" });
    return UNREADABLE_STANDING;
  }

  if (!read.ok) {
    billingLogger().warn("billing.entitlement_unreadable", { kind: read.error.kind });
    return UNREADABLE_STANDING;
  }
  return standingFrom(read.data, new Date());
});

/** The plan alone, for callers that decide nothing else. */
export async function currentEntitlement(learnerId: string): Promise<Entitlement> {
  return (await currentBilling(learnerId)).entitlement;
}

export interface RequestPlan {
  readonly plan: PlanCode;
  /**
   * False when the rows could not be read and the plan is Free as the floor.
   * The route still serves Free — nobody is handed more than they paid for —
   * but it does not offer that learner an upgrade they may already hold.
   */
  readonly readable: boolean;
}

/**
 * The plan a model-spending route serves this request on (spec S3, S5).
 *
 * The learner id is the verified session's, never a body's; the plan is the
 * entitlement rows', never a header's, a cookie's or a client's claim. The
 * routes call this once, after their per-minute limit, and hand the result to
 * the quota, the routing and the budget gate alike, so one request cannot be
 * routed as one plan and budgeted as another.
 */
export async function planForRequest(learnerId: string): Promise<RequestPlan> {
  const standing = await currentBilling(learnerId);
  return { plan: standing.entitlement.plan, readable: standing.readable };
}
