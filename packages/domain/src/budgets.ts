import { z } from "zod";

/**
 * The euro budgets, as the gateway enforces them and an operator sets them.
 *
 * One definition of the scopes and the thresholds, so the gate that refuses a
 * call and the page that explains why cannot disagree about what 90% means
 * (model-routing-and-cost-control.md S9, cost-dashboard-spec.md S6).
 *
 * Money crosses this module as decimal strings. The column is numeric(12,4);
 * a float between the form and the column is how 0.1 + 0.2 becomes a limit
 * nobody typed (cost-dashboard-spec.md S8: money is never a float).
 */

export const BUDGET_SCOPES = [
  "per_request",
  "per_user_daily",
  "per_user_monthly",
  "global_daily",
] as const;

export const budgetScopeSchema = z.enum(BUDGET_SCOPES);
export type BudgetScope = z.infer<typeof budgetScopeSchema>;

/**
 * The scopes the gateway reads from `budget_limits`, through `budget_snapshot`.
 *
 * Not per_request: the per-turn cap is a constant at each call site, carried
 * on the request context, and `budget_snapshot` excludes the scope outright.
 * A row for it is read by nothing, so it is not offered as something to set.
 */
export const ENFORCED_BUDGET_SCOPES = [
  "global_daily",
  "per_user_daily",
  "per_user_monthly",
] as const satisfies readonly BudgetScope[];

export const enforcedBudgetScopeSchema = z.enum(ENFORCED_BUDGET_SCOPES);
export type EnforcedBudgetScope = z.infer<typeof enforcedBudgetScopeSchema>;

/** The scopes an override for one learner can sit under. */
export const PER_USER_BUDGET_SCOPES = [
  "per_user_daily",
  "per_user_monthly",
] as const satisfies readonly EnforcedBudgetScope[];

export const isPerUserScope = (scope: BudgetScope): boolean =>
  (PER_USER_BUDGET_SCOPES as readonly BudgetScope[]).includes(scope);

export const BUDGET_STATES = ["allow", "warn", "degrade", "deny"] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];

export interface BudgetThresholds {
  readonly limitEur: number;
  readonly spentEur: number;
  readonly warnPct: number;
  readonly degradePct: number;
}

/**
 * Where spend stands against one limit.
 *
 * The gate calls this with the projected cost of the call it is about to
 * make; the dashboard calls it with none. A zero limit is a closed door, not
 * an unlimited one.
 */
export function budgetState(thresholds: BudgetThresholds, projectedEur = 0): BudgetState {
  if (thresholds.limitEur <= 0) return "deny";

  const ratio = (thresholds.spentEur + projectedEur) / thresholds.limitEur;

  if (ratio >= 1) return "deny";
  if (ratio >= thresholds.degradePct) return "degrade";
  if (ratio >= thresholds.warnPct) return "warn";
  return "allow";
}

// --- what an operator submits -------------------------------------------------

/**
 * The most any one limit may be set to.
 *
 * Far above anything this product spends in a day, and far below what a
 * slipped digit produces. A budget is a ceiling, and a ceiling of 50,000 EUR
 * typed for 50 is not one.
 */
export const MAX_LIMIT_EUR = 10_000;

/**
 * A euro amount as typed, kept as a decimal string.
 *
 * A comma is read as the decimal point, because a de-DE keyboard types one.
 * Four places, because that is what the column keeps and what a nano-tier
 * per-learner budget needs.
 */
export const eurAmountSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(",", "."))
  .pipe(
    z
      .string()
      .regex(/^\d{1,5}(\.\d{1,4})?$/, "a euro amount with at most four decimal places")
      .refine((value) => {
        const [whole = "0", fraction = ""] = value.split(".");
        const units = Number(whole);
        return units < MAX_LIMIT_EUR || (units === MAX_LIMIT_EUR && /^0*$/.test(fraction));
      }, `at most ${MAX_LIMIT_EUR} EUR`),
  );

/**
 * A threshold as a whole percentage, stored as the fraction the column holds.
 *
 * Whole numbers only: "warn at 70%" is how the routing document states them
 * and how anyone reasons about them.
 */
export const percentSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, "a whole percentage")
  .transform(Number)
  .pipe(z.number().int().min(1).max(100))
  .transform((pct) => (pct / 100).toFixed(2));

/** The ledger's pseudonym for a learner. Never an id, never an email. */
export const userIdHashSchema = z.string().regex(/^[0-9a-f]{32}$/, "a learner pseudonym");

export const budgetLimitInputSchema = z
  .object({
    scope: enforcedBudgetScopeSchema,
    scopeKey: z
      .string()
      .trim()
      .nullable()
      .transform((value) => (value === null || value === "" ? null : value))
      .pipe(userIdHashSchema.nullable()),
    limitEur: eurAmountSchema,
    warnPct: percentSchema,
    degradePct: percentSchema,
    active: z.boolean(),
  })
  .refine((input) => Number(input.warnPct) <= Number(input.degradePct), {
    message: "warn must come before degrade",
    path: ["warnPct"],
  })
  .refine((input) => input.scopeKey === null || isPerUserScope(input.scope), {
    // budget_snapshot only ever matches a key against a learner's hash.
    message: "only a per-learner scope can be overridden for one learner",
    path: ["scopeKey"],
  })
  .refine((input) => input.active || input.scopeKey !== null, {
    // No row for a scope is no limit at all. Fail closed means a default can be
    // lowered, even to zero, but not switched off from a form.
    message: "a scope's default cannot be switched off; set its limit instead",
    path: ["active"],
  });

export type BudgetLimitInput = z.infer<typeof budgetLimitInputSchema>;
