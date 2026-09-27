import { isPerUserScope, type BudgetScope } from "@dp/domain/budgets";
import { periodFor } from "@dp/gateway/budget-gate";

/**
 * A learner's own euro allowance, as a refusal speaks of it.
 *
 * The gateway names the scope that refused a call; this is the one place that
 * decides what that means to the learner (billing-and-plans-spec.md S9). Pure,
 * so the graph can ask it without reaching for anything that counts.
 */

/**
 * Whether a euro denial was the learner's own allowance running out.
 *
 * Only the per-learner scopes are. The product's daily ceiling is nobody's
 * allowance, an unreadable counter is an outage, and the per-request bound is
 * one request that was too large; none of those is something a larger plan
 * answers, so none of them is shown as an upgrade prompt.
 */
export function isAllowanceScope(scope: BudgetScope | null | undefined): scope is BudgetScope {
  return scope !== null && scope !== undefined && isPerUserScope(scope);
}

/** When a spent allowance comes back: the end of the counter's own period, in UTC. */
export function allowanceRenewsAt(scope: BudgetScope, now: Date): Date {
  return periodFor(scope, now).end;
}
