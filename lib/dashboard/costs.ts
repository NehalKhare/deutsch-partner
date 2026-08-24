import { z } from "zod";

import { tierSchema } from "@/lib/ai/tasks";
import { fail, ok, repositoryError, type RepositoryResult } from "@/repositories/errors";
import type { DatabaseClient } from "@/repositories/types";

/**
 * The operator's spend view.
 *
 * Aggregated in the database over a window, reported in euro, and derived from
 * the rate stored on each row rather than recomputed — historical spend was
 * true at the rate that applied then, and restating it when the rate moves
 * would make last month's figures change without last month changing.
 *
 * Nothing here carries conversation content or an identifying field. The
 * ledger only ever held a pseudonym, so there is nothing on this screen to
 * leak even to somebody who reaches it.
 */

const numeric = z.coerce.number();

export const costSummarySchema = z.object({
  window: z.object({ from: z.coerce.date(), to: z.coerce.date() }),
  totals: z.object({
    call_count: numeric.int().min(0),
    learner_count: numeric.int().min(0),
    cost_eur: numeric.min(0),
    input_tokens: numeric.int().min(0),
    output_tokens: numeric.int().min(0),
    failures: numeric.int().min(0),
    budget_denials: numeric.int().min(0),
    truncations: numeric.int().min(0),
    degraded: numeric.int().min(0),
    unpriced: numeric.int().min(0),
  }),
  byTask: z
    .array(
      z.object({
        task: z.string(),
        tier: tierSchema,
        calls: numeric.int().min(0),
        costEur: numeric.min(0),
        inputTokens: numeric.int().min(0),
        outputTokens: numeric.int().min(0),
      }),
    )
    .max(50),
  byModel: z
    .array(
      z.object({
        modelId: z.string(),
        calls: numeric.int().min(0),
        costEur: numeric.min(0),
      }),
    )
    .max(50),
  /** The rate and date behind every euro figure on the page. */
  fxRate: z
    .array(
      z.object({
        rate: numeric.positive(),
        rateDate: z.string(),
        source: z.string(),
      }),
    )
    .max(1),
});

export type CostSummary = z.infer<typeof costSummarySchema>;

export interface CostRepository {
  summary(from: Date, to: Date): Promise<RepositoryResult<CostSummary>>;
}

export function createCostRepository(client: DatabaseClient): CostRepository {
  return {
    async summary(from, to) {
      const outcome = await client.rpc("cost_dashboard", {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });

      if (outcome.error) return fail(repositoryError("unavailable", outcome.error));

      const parsed = costSummarySchema.safeParse(outcome.data);

      return parsed.success
        ? ok(parsed.data)
        : fail(repositoryError("invalid_data", parsed.error));
    },
  };
}

// --- alerting ---------------------------------------------------------------

export const ALERT_LEVELS = ["ok", "warn", "degrade", "deny"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export interface SpendAlert {
  readonly level: AlertLevel;
  readonly scope: string;
  readonly detail: string;
}

/**
 * What the dashboard should be shouting about.
 *
 * The same thresholds the gateway gates on, so the screen and the enforcement
 * cannot disagree about whether today is fine. A global denial is an incident
 * rather than a metric: the routing document says it should page, and this is
 * the value a pager would read.
 */
export function spendAlerts(
  summary: CostSummary,
  limits: { readonly globalDailyEur: number },
): readonly SpendAlert[] {
  const alerts: SpendAlert[] = [];
  const spent = summary.totals.cost_eur;
  const ratio = limits.globalDailyEur > 0 ? spent / limits.globalDailyEur : Infinity;

  if (ratio >= 1) {
    alerts.push({
      level: "deny",
      scope: "global_daily",
      detail: `spend is at ${(ratio * 100).toFixed(0)}% of the daily limit`,
    });
  } else if (ratio >= 0.9) {
    alerts.push({
      level: "degrade",
      scope: "global_daily",
      detail: `spend is at ${(ratio * 100).toFixed(0)}% of the daily limit`,
    });
  } else if (ratio >= 0.7) {
    alerts.push({
      level: "warn",
      scope: "global_daily",
      detail: `spend is at ${(ratio * 100).toFixed(0)}% of the daily limit`,
    });
  }

  if (summary.totals.budget_denials > 0) {
    // Repeated denials are a security audit event, not only a cost one:
    // somebody may be trying to impose a bill.
    alerts.push({
      level: "warn",
      scope: "budget_denied",
      detail: `${summary.totals.budget_denials} call${summary.totals.budget_denials === 1 ? "" : "s"} denied`,
    });
  }

  if (summary.totals.unpriced > 0) {
    alerts.push({
      level: "warn",
      scope: "fx_stale",
      detail: `${summary.totals.unpriced} call${summary.totals.unpriced === 1 ? "" : "s"} could not be priced in euro`,
    });
  }

  if (summary.totals.truncations > 0) {
    alerts.push({
      level: "warn",
      scope: "truncated",
      detail: `${summary.totals.truncations} repl${summary.totals.truncations === 1 ? "y was" : "ies were"} cut at the output ceiling`,
    });
  }

  return alerts;
}

export const worstAlert = (alerts: readonly SpendAlert[]): AlertLevel =>
  alerts.reduce<AlertLevel>(
    (worst, alert) =>
      ALERT_LEVELS.indexOf(alert.level) > ALERT_LEVELS.indexOf(worst)
        ? alert.level
        : worst,
    "ok",
  );

/** Cost per learner over the window. The number that decides whether this ships. */
export function spendPerLearner(summary: CostSummary): number {
  return summary.totals.learner_count === 0
    ? 0
    : summary.totals.cost_eur / summary.totals.learner_count;
}
