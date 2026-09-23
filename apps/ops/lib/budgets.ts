import {
  ENFORCED_BUDGET_SCOPES,
  budgetState,
  isPerUserScope,
  type BudgetState,
  type EnforcedBudgetScope,
} from "@dp/domain/budgets";
import type { BudgetLimit, BudgetOverview, LearnerSpend } from "@dp/db/budget-repository";

/**
 * The budget page's reading of the overview.
 *
 * Nothing here decides anything the gate does not. The state of a meter is
 * the domain's `budgetState`, the same function the gateway gates on, so a
 * bar that reads "degrade" is a learner being served the cheaper tier right
 * now. The one addition is "unlimited": a scope with no active default is not
 * at zero percent of anything, and the page says so rather than drawing an
 * empty bar that looks like good news.
 */

export type MeterState = BudgetState | "unlimited";

export interface Meter {
  readonly limitEur: number | null;
  readonly spentEur: number;
  /** Spend over limit; null when there is no limit to divide by. */
  readonly ratio: number | null;
  readonly state: MeterState;
}

export interface BudgetBoard {
  /** One entry per enforced scope, in the order the page shows them. */
  readonly scopes: ReadonlyArray<{
    readonly scope: EnforcedBudgetScope;
    /** The active default, or null: no limit at this scope. */
    readonly limit: BudgetLimit | null;
  }>;
  /** Scopes the gateway currently enforces no limit at. */
  readonly unlimited: readonly EnforcedBudgetScope[];
  /** Per-learner rows, active or paused. */
  readonly overrides: readonly BudgetLimit[];
  /** Rows for a scope nothing reads from the table. Shown so nobody trusts them. */
  readonly unenforced: readonly BudgetLimit[];
}

const activeDefault = (limits: readonly BudgetLimit[], scope: EnforcedBudgetScope) =>
  limits.find((row) => row.scope === scope && row.scopeKey === null && row.active) ?? null;

export function budgetBoard(overview: BudgetOverview): BudgetBoard {
  const scopes = ENFORCED_BUDGET_SCOPES.map((scope) => ({
    scope,
    limit: activeDefault(overview.limits, scope),
  }));

  return {
    scopes,
    unlimited: scopes.filter((row) => row.limit === null).map((row) => row.scope),
    overrides: overview.limits.filter((row) => row.scopeKey !== null && isPerUserScope(row.scope)),
    unenforced: overview.limits.filter((row) => row.scope === "per_request"),
  };
}

function meter(
  spentEur: number,
  limit: { limitEur: number; warnPct: number; degradePct: number } | null,
): Meter {
  if (limit === null) return { limitEur: null, spentEur, ratio: null, state: "unlimited" };

  return {
    limitEur: limit.limitEur,
    spentEur,
    ratio: limit.limitEur > 0 ? Math.round((spentEur / limit.limitEur) * 1e4) / 1e4 : null,
    state: budgetState({ ...limit, spentEur }),
  };
}

/** Today's whole-application spend against the global daily limit. */
export function globalMeter(overview: BudgetOverview): Meter {
  return meter(overview.globalSpentEur, activeDefault(overview.limits, "global_daily"));
}

/** The active global daily limit, or null when none is set. */
export function globalDailyLimit(overview: BudgetOverview): BudgetLimit | null {
  return activeDefault(overview.limits, "global_daily");
}

/** The limit the spend page draws its line at, or null when none is set. */
export function globalDailyLimitEur(overview: BudgetOverview): number | null {
  return globalDailyLimit(overview)?.limitEur ?? null;
}

/** One learner's spend against the limit that applies to them. */
export function learnerMeter(row: LearnerSpend): Meter {
  return meter(
    row.spentEur,
    row.limitEur === null
      ? null
      : { limitEur: row.limitEur, warnPct: row.warnPct ?? 1, degradePct: row.degradePct ?? 1 },
  );
}

/** How each scope is named on the page. */
export const SCOPE_LABELS: Readonly<Record<EnforcedBudgetScope, string>> = {
  global_daily: "Whole product, per day",
  per_user_daily: "Each learner, per day",
  per_user_monthly: "Each learner, per month",
};

// --- the edit form --------------------------------------------------------------

/** What a budget form shows after a submit. */
export interface BudgetFormState {
  readonly status: "idle" | "saved" | "error";
  readonly message: string;
}

export const BUDGET_FORM_IDLE: BudgetFormState = { status: "idle", message: "" };
