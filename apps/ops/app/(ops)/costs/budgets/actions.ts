"use server";

import { refresh } from "next/cache";

import { budgetLimitInputSchema, PER_USER_BUDGET_SCOPES, userIdHashSchema } from "@dp/domain/budgets";
import type { BudgetLimit } from "@dp/db/budget-repository";
import { z } from "zod";

import { createCostAdmin } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { operatorForAction } from "@/lib/auth/require-operator";
import type { BudgetFormState } from "@/lib/budgets";

/**
 * Changing what the product may spend.
 *
 * These are the only writes to `budget_limits` anywhere, and the gateway reads
 * that table on every model call: a save here changes who is served, degraded
 * or refused within the second. So each one re-checks the operator on its own,
 * is rate limited, validates in the domain and again in the database, and is
 * an audit event carrying the row as it was and as it is (guardrails S24:
 * privileged operations, admin activity).
 *
 * The audit trail is the log for now. It is attributed to the operator's
 * pseudonym, never their id, like every other operator write.
 */

/** Both gates, in the order they fail. Null means refuse, and say no more. */
async function admitOperator(route: string): Promise<string | null> {
  const operator = await operatorForAction(route);
  if (operator === null) return null;

  const decision = await limiterFor("ops_cost_admin").check(operator.hash);
  return decision.allowed ? operator.hash : null;
}

const NOT_SAVED: BudgetFormState = { status: "error", message: "Not saved. Try again." };

/** The figures an audit line needs, and nothing that identifies anybody. */
const auditable = (row: BudgetLimit | null) =>
  row === null
    ? null
    : {
        limitEur: row.limitEur,
        warnPct: row.warnPct,
        degradePct: row.degradePct,
        active: row.active,
      };

/**
 * Creates or edits one limit.
 *
 * Returns what the form should say. A refusal from the operator gate or the
 * rate limiter reads the same as any failed save, so the response says
 * nothing about who is an operator.
 */
export async function saveBudgetLimitAction(
  _previous: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const operator = await admitOperator("/costs/budgets/save");
  if (operator === null) return NOT_SAVED;

  const input = budgetLimitInputSchema.safeParse({
    scope: formData.get("scope"),
    scopeKey: formData.get("scopeKey") ?? null,
    limitEur: formData.get("limitEur") ?? "",
    warnPct: formData.get("warnPct") ?? "",
    degradePct: formData.get("degradePct") ?? "",
    // A checkbox posts nothing when unticked.
    active: formData.get("active") === "on",
  });
  if (!input.success) {
    // The domain's own messages, written for this form: safe to show.
    return { status: "error", message: input.error.issues[0]?.message ?? NOT_SAVED.message };
  }

  const { budgets, logger } = createCostAdmin();
  const saved = await budgets.setLimit(input.data);

  if (!saved.ok) {
    logger.warn("budget.limit_not_saved", {
      scope: input.data.scope,
      errorKind: saved.error.kind,
      userIdHash: operator,
    });
    return NOT_SAVED;
  }

  logger.info("budget.limit_changed", {
    audit: true,
    userIdHash: operator,
    scope: saved.data.after.scope,
    // A learner's pseudonym when this is an override. Never an id.
    scopeKey: saved.data.after.scopeKey,
    before: auditable(saved.data.before),
    after: auditable(saved.data.after),
  });

  refresh();
  return { status: "saved", message: "Saved. The gateway applies it from the next call." };
}

const overrideSchema = z.object({
  scope: z.enum(PER_USER_BUDGET_SCOPES),
  scopeKey: userIdHashSchema,
});

/** Removes one learner's override, so the scope's default applies to them again. */
export async function removeBudgetOverrideAction(formData: FormData): Promise<void> {
  const operator = await admitOperator("/costs/budgets/remove");
  if (operator === null) return;

  const input = overrideSchema.safeParse({
    scope: formData.get("scope"),
    scopeKey: formData.get("scopeKey"),
  });
  if (!input.success) return;

  const { budgets, logger } = createCostAdmin();
  const removed = await budgets.removeOverride(input.data);

  if (!removed.ok) {
    logger.warn("budget.override_not_removed", {
      scope: input.data.scope,
      errorKind: removed.error.kind,
      userIdHash: operator,
    });
  } else if (removed.data !== null) {
    logger.info("budget.override_removed", {
      audit: true,
      userIdHash: operator,
      scope: input.data.scope,
      scopeKey: input.data.scopeKey,
      before: auditable(removed.data),
    });
  }

  refresh();
}
