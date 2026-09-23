import { z } from "zod";

import {
  budgetScopeSchema,
  enforcedBudgetScopeSchema,
  eurAmountSchema,
  PER_USER_BUDGET_SCOPES,
  userIdHashSchema,
  type BudgetLimitInput,
  type BudgetScope,
} from "@dp/domain/budgets";

import { fail, mapDatabaseError, ok, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput, decodeRow } from "./result";
import type { DatabaseClient } from "./types";

/**
 * The euro budgets, from the operator's side.
 *
 * The gateway reads `budget_limits` through `budget_snapshot` on every call;
 * this is the other end — the overview an operator reads and the two writes
 * they can make. Operator scope: every function behind it is revoked from
 * authenticated, so this is only ever constructed with the secret-key client.
 *
 * Limits go in as the decimal strings the domain validated. They come out as
 * numbers, because they are read to be displayed and compared, not summed
 * back into a column.
 */

const numeric = z.coerce.number();

const limitSchema = z.object({
  id: z.coerce.number().int(),
  scope: budgetScopeSchema,
  scopeKey: z.string().nullable(),
  limitEur: numeric.min(0),
  warnPct: numeric.min(0).max(1),
  degradePct: numeric.min(0).max(1),
  active: z.boolean(),
  updatedAt: z.coerce.date(),
});

export type BudgetLimit = z.infer<typeof limitSchema>;

/** A row as `to_jsonb(budget_limits)` spells it, for the before and after of an edit. */
const limitRowSchema = z
  .object({
    id: z.coerce.number().int(),
    scope: budgetScopeSchema,
    scope_key: z.string().nullable(),
    limit_eur: numeric,
    warn_pct: numeric,
    degrade_pct: numeric,
    active: z.boolean(),
    updated_at: z.coerce.date(),
  })
  .transform(
    (row): BudgetLimit => ({
      id: row.id,
      scope: row.scope,
      scopeKey: row.scope_key,
      limitEur: row.limit_eur,
      warnPct: row.warn_pct,
      degradePct: row.degrade_pct,
      active: row.active,
      updatedAt: row.updated_at,
    }),
  );

const learnerSpendSchema = z.object({
  scope: z.enum(PER_USER_BUDGET_SCOPES),
  userIdHash: z.string(),
  spentEur: numeric.min(0),
  /** Null when neither an override nor a default applies: unlimited, not zero. */
  limitEur: numeric.min(0).nullable(),
  warnPct: numeric.nullable(),
  degradePct: numeric.nullable(),
  overridden: z.boolean(),
});

export type LearnerSpend = z.infer<typeof learnerSpendSchema>;

export const budgetOverviewSchema = z.object({
  generatedAt: z.coerce.date(),
  /** The UTC day the daily counters cover. */
  dayStart: z.coerce.date(),
  /** The UTC month the monthly counters cover. */
  monthStart: z.coerce.date(),
  limits: z.array(limitSchema).max(10_000),
  globalSpentEur: numeric.min(0),
  learners: z.array(learnerSpendSchema).max(200),
  /** Everyone with a counter this period, not only those listed. */
  learnerCounts: z.object({
    daily: z.coerce.number().int().min(0),
    monthly: z.coerce.number().int().min(0),
  }),
});

export type BudgetOverview = z.infer<typeof budgetOverviewSchema>;

export interface BudgetChange {
  readonly before: BudgetLimit | null;
  readonly after: BudgetLimit;
}

const changeSchema = z.object({
  before: limitRowSchema.nullable(),
  after: limitRowSchema,
});

const overrideKeySchema = z.object({
  scope: z.enum(PER_USER_BUDGET_SCOPES),
  scopeKey: userIdHashSchema,
});

/** How many learners per scope the overview lists. */
export const BUDGET_LEARNERS_SHOWN = 20;

export interface BudgetRepository {
  overview(now: Date): Promise<RepositoryResult<BudgetOverview>>;
  /** Creates or edits the one row for a scope and key. */
  setLimit(input: BudgetLimitInput): Promise<RepositoryResult<BudgetChange>>;
  /** Removes one learner's override. Null when there was none. */
  removeOverride(input: {
    readonly scope: BudgetScope;
    readonly scopeKey: string;
  }): Promise<RepositoryResult<BudgetLimit | null>>;
}

export function createBudgetRepository(client: DatabaseClient): BudgetRepository {
  return {
    async overview(now) {
      const outcome = await client.rpc("budget_overview", {
        p_now: now.toISOString(),
        p_top: BUDGET_LEARNERS_SHOWN,
      });

      return decodeRow(outcome, budgetOverviewSchema);
    },

    async setLimit(input) {
      // Validated again here, not trusted from the caller: the strings that
      // reach the column are the ones this schema produced. The input is
      // already in its parsed shape, so the percentages are fractions and
      // are checked as such rather than re-parsed as whole numbers.
      const parsed = decodeInput(
        input,
        z.object({
          scope: enforcedBudgetScopeSchema,
          scopeKey: userIdHashSchema.nullable(),
          limitEur: eurAmountSchema,
          warnPct: z.string().regex(/^(0\.\d{1,3}|1(\.0{1,3})?)$/),
          degradePct: z.string().regex(/^(0\.\d{1,3}|1(\.0{1,3})?)$/),
          active: z.boolean(),
        }),
      );
      if (!parsed.ok) return parsed;

      const outcome = await client.rpc("set_budget_limit", {
        p_scope: parsed.data.scope,
        p_scope_key: parsed.data.scopeKey,
        p_limit_eur: parsed.data.limitEur,
        p_warn_pct: parsed.data.warnPct,
        p_degrade_pct: parsed.data.degradePct,
        p_active: parsed.data.active,
      });

      return decodeRow(outcome, changeSchema);
    },

    async removeOverride(input) {
      const parsed = decodeInput(input, overrideKeySchema);
      if (!parsed.ok) return parsed;

      const outcome = await client.rpc("remove_budget_override", {
        p_scope: parsed.data.scope,
        p_scope_key: parsed.data.scopeKey,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      if (outcome.data === null || outcome.data === undefined) return ok(null);

      const removed = limitRowSchema.safeParse(outcome.data);
      return removed.success ? ok(removed.data) : fail(repositoryError("invalid_data", removed.error));
    },
  };
}
