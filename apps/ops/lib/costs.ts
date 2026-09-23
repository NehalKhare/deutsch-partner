import { z } from "zod";

import { budgetState } from "@dp/domain/budgets";
import { tierSchema } from "@dp/domain/tasks";
import { fail, ok, repositoryError, type RepositoryResult } from "@dp/db/errors";
import type { DatabaseClient } from "@dp/db/types";

/**
 * The operator's spend view.
 *
 * Aggregated in the database over a window, reported in euro, and derived from
 * the rate stored on each row rather than recomputed — historical spend was
 * true at the rate that applied then, and restating it when the rate moves
 * would make last month's figures change without last month changing.
 *
 * Dollars come through beside it, because euro is the derived figure and can
 * be missing. A call whose row was written before any rate had been snapshotted
 * carries an exact dollar cost and a euro cost of zero, and a screen that
 * showed only the second would report a busy day as free. Euro leads; dollars
 * are what makes the page true when it cannot.
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
    cost_usd: numeric.min(0),
    /** The dollars belonging to rows that carry no euro figure of their own. */
    cost_usd_unpriced: numeric.min(0),
    input_tokens: numeric.int().min(0),
    output_tokens: numeric.int().min(0),
    failures: numeric.int().min(0),
    budget_denials: numeric.int().min(0),
    truncations: numeric.int().min(0),
    degraded: numeric.int().min(0),
    /** Rows carrying no rate at all. Their euro figure is zero and is not spend. */
    unpriced: numeric.int().min(0),
    /** Rows priced at a rate from an earlier day. Normal over a weekend. */
    carried_forward: numeric.int().min(0),
  }),
  byTask: z
    .array(
      z.object({
        task: z.string(),
        tier: tierSchema,
        /**
         * What the provider actually ran, which is not always what the
         * registry asked for: OpenRouter resolves, tiers escalate, providers
         * fall back. A task that reached two models is two rows here.
         */
        modelId: z.string(),
        calls: numeric.int().min(0),
        costEur: numeric.min(0),
        costUsd: numeric.min(0),
        costUsdUnpriced: numeric.min(0),
        inputTokens: numeric.int().min(0),
        outputTokens: numeric.int().min(0),
      }),
    )
    .max(200),
  byModel: z
    .array(
      z.object({
        modelId: z.string(),
        calls: numeric.int().min(0),
        costEur: numeric.min(0),
        costUsd: numeric.min(0),
        costUsdUnpriced: numeric.min(0),
      }),
    )
    .max(200),
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

// --- completing the euro column ---------------------------------------------

/** The precision the ledger's numeric columns store. */
const SCALE = 1e8;

export interface EuroTotal {
  /** Stored euro plus the estimate below. What the page leads with. */
  readonly total: number;
  /** What was charged, converted on the day and never restated. */
  readonly charged: number;
  /** Unpriced dollars at the newest rate. An estimate, and labelled as one. */
  readonly estimated: number;
  /** How many rows the estimate covers. Zero means the total is all charged. */
  readonly estimatedCalls: number;
}

/**
 * The rate the page converts unpriced rows at, or undefined.
 *
 * The newest snapshot, which is not the rate any of those rows would have had
 * — they have none, which is the entire problem with them.
 */
export function conversionRate(summary: CostSummary): number | undefined {
  return summary.fxRate[0]?.rate;
}

/** Stored euro, plus whatever dollars carry no euro of their own, converted. */
export function inEur(
  costEur: number,
  unpricedUsd: number,
  rate: number | undefined,
): number {
  if (rate === undefined) return costEur;

  return Math.round((costEur + unpricedUsd * rate) * SCALE) / SCALE;
}

/**
 * What the window cost in euro, including the rows nobody could price.
 *
 * Two kinds of money added together, and the split is kept because they are
 * not the same claim. The charged part was converted at the rate that applied
 * on the day and is what the provider billed. The estimated part is dollars
 * from rows written before any rate existed, converted at today's — a figure
 * that is right about the magnitude and cannot be right about the day.
 *
 * Nothing here writes. The ledger is append-only and those rows keep their
 * stored zero; this is the reading, not a correction.
 */
export function pricedInEur(summary: CostSummary): EuroTotal {
  const rate = conversionRate(summary);
  const totals = summary.totals;
  const estimated =
    rate === undefined
      ? 0
      : Math.round(totals.cost_usd_unpriced * rate * SCALE) / SCALE;

  return {
    total: Math.round((totals.cost_eur + estimated) * SCALE) / SCALE,
    charged: totals.cost_eur,
    estimated,
    estimatedCalls: rate === undefined ? 0 : totals.unpriced,
  };
}

// --- alerting ---------------------------------------------------------------

export const ALERT_LEVELS = ["ok", "warn", "degrade", "deny"] as const;

/** The routing document's thresholds, for a limit that does not carry its own. */
const DEFAULT_WARN_PCT = 0.7;
const DEFAULT_DEGRADE_PCT = 0.9;
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
  limits: {
    /** The active global daily limit, or null when none is configured. */
    readonly globalDailyEur: number | null;
    readonly warnPct?: number;
    readonly degradePct?: number;
  },
): readonly SpendAlert[] {
  const alerts: SpendAlert[] = [];
  // The completed figure, not the stored one: a limit checked against a column
  // that reads zero for every unpriced row is a limit nothing can reach.
  const spent = pricedInEur(summary).total;

  if (limits.globalDailyEur === null) {
    alerts.push({
      level: "warn",
      scope: "global_daily",
      detail: "no global daily limit is configured, so spend is uncapped; set one under Budgets",
    });
  } else {
    // The gateway's own arithmetic, so the screen and the gate agree.
    const state = budgetState({
      limitEur: limits.globalDailyEur,
      spentEur: spent,
      warnPct: limits.warnPct ?? DEFAULT_WARN_PCT,
      degradePct: limits.degradePct ?? DEFAULT_DEGRADE_PCT,
    });
    const ratio = limits.globalDailyEur > 0 ? spent / limits.globalDailyEur : Infinity;

    if (state !== "allow") {
      alerts.push({
        level: state,
        scope: "global_daily",
        detail: Number.isFinite(ratio)
          ? `spend is at ${(ratio * 100).toFixed(0)}% of the daily limit`
          : "the daily limit is zero, so every call is refused",
      });
    }
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

  if (summary.totals.unpriced > 0 && conversionRate(summary) === undefined) {
    // Only when there is no rate to convert them with. Once there is one the
    // page states what it converted and at which rate, in the line under the
    // title, which is where a caveat about a figure belongs — a banner that
    // fires on every window containing an old call is a banner nobody reads.
    alerts.push({
      level: "warn",
      scope: "fx_unpriced",
      detail:
        `${summary.totals.unpriced} call${summary.totals.unpriced === 1 ? "" : "s"} ` +
        "carry no exchange rate and no rate has been snapshotted to convert them at",
    });
  }

  const pipeline = fxPipelineAlert(summary);
  if (pipeline) alerts.push(pipeline);

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

/**
 * Whether the rate behind the euro column is still being refreshed.
 *
 * The snapshot job runs daily and the source publishes on business days, so a
 * rate one day old is ordinary and a rate three days old over a weekend still
 * is. Older than that, or absent entirely, and the job has stopped: every row
 * written since has been priced at a rate nobody checked, or not priced at all.
 */
const FX_PIPELINE_STALE_AFTER_DAYS = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

function fxPipelineAlert(summary: CostSummary): SpendAlert | null {
  const newest = summary.fxRate[0];

  if (newest === undefined) {
    // Nothing to warn about on a window with no calls in it.
    return summary.totals.call_count === 0
      ? null
      : {
          level: "warn",
          scope: "fx_pipeline",
          detail: "no exchange rate has ever been snapshotted; run the refresh job",
        };
  }

  const published = Date.parse(`${newest.rateDate}T00:00:00.000Z`);
  if (Number.isNaN(published)) return null;

  const age = (summary.window.to.getTime() - published) / DAY_MS;

  return age <= FX_PIPELINE_STALE_AFTER_DAYS
    ? null
    : {
        level: "warn",
        scope: "fx_pipeline",
        detail: `the newest exchange rate is from ${newest.rateDate}`,
      };
}

/** Cost per learner over the window. The number that decides whether this ships. */
export function spendPerLearner(summary: CostSummary): number {
  return summary.totals.learner_count === 0
    ? 0
    : pricedInEur(summary).total / summary.totals.learner_count;
}

/**
 * The same figure in dollars.
 *
 * Not a nicety: euro is derived and can be zero for a window in which real
 * money was spent, and cost per learner is the number that decides whether
 * this product can ship. It should not be able to read zero while the ledger
 * says otherwise.
 */
export function spendPerLearnerUsd(summary: CostSummary): number {
  return summary.totals.learner_count === 0
    ? 0
    : summary.totals.cost_usd / summary.totals.learner_count;
}
