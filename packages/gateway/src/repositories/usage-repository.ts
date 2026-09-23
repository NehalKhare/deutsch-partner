import { z } from "zod";

import {
  budgetScopeSchema,
  type BudgetSnapshot,
  type BudgetSource,
} from "../budget-gate";
import type {
  FxRateSnapshots,
  FxRateStore,
  FxWriteResult,
  StoredFxRate,
} from "../fx";
import type {
  BudgetIncrement,
  LedgerRow,
  LedgerWriteResult,
  UsageLedger,
} from "../ledger";
import type { ModelRate, PricingStore } from "../pricing";
import { nullLogger, type Logger } from "@dp/observability/logger";
import type { DatabaseClient } from "@dp/db/types";

/**
 * The accounting tables, from the gateway's side.
 *
 * These are operator-scope tables with RLS enabled and no policy, so only the
 * service role reaches them. The gateway depends on the four small interfaces
 * below rather than on this file, which is what lets its tests drive it
 * without a database and keeps the SQL in one place.
 *
 * Rows are validated on the way out like every other read. A budget figure
 * that silently arrives as a string, which is what a numeric column does over
 * PostgREST, is a budget check that quietly compares text.
 */

const numeric = z.coerce.number();

const snapshotRowSchema = z.object({
  scope: budgetScopeSchema,
  scope_key: z.string().nullable(),
  limit_eur: numeric,
  spent_eur: numeric,
  warn_pct: numeric,
  degrade_pct: numeric,
});

const fxRowSchema = z.object({
  rate: numeric.positive(),
  rate_date: z.string(),
  source: z.string(),
});

const rateRowSchema = z.object({
  provider: z.string(),
  model_id: z.string(),
  input_price_per_token: numeric,
  output_price_per_token: numeric,
  currency: z.string(),
  fetched_at: z.coerce.date(),
});

/** The ledger's snake_case wire shape. Column names, not a serialised object. */
function toInvocationPayload(row: LedgerRow): Record<string, unknown> {
  return {
    request_id: row.requestId,
    trace_id: row.traceId,
    span_id: row.spanId,
    user_id_hash: row.userIdHash,
    thread_id: row.threadId,
    message_id: row.messageId,
    task: row.task,
    tier: row.tier,
    prompt_name: row.promptName,
    prompt_version: row.promptVersion,
    prompt_fingerprint: row.promptFingerprint,
    provider: row.provider,
    model_id: row.modelId,
    model_id_resolved: row.modelIdResolved,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    reasoning_tokens: row.reasoningTokens,
    cached_input_tokens: row.cachedInputTokens,
    max_output_tokens: row.maxOutputTokens,
    truncated: row.truncated,
    escalated: row.escalated,
    degraded: row.degraded,
    budget_scope_hit: row.budgetScopeHit,
    attempt_number: row.attemptNumber,
    latency_ms: row.latencyMs,
    first_token_ms: row.firstTokenMs,
    status: row.status,
    error_code: row.errorCode,
    cost_usd: row.costUsd,
    fx_rate_eur_per_usd: row.fxRateEurPerUsd,
    fx_stale: row.fxStale,
    cost_eur: row.costEur,
  };
}

function toIncrementPayload(increment: BudgetIncrement): Record<string, unknown> {
  return {
    scope: increment.scope,
    scope_key: increment.scopeKey,
    period_start: increment.periodStart.toISOString(),
    period_end: increment.periodEnd.toISOString(),
    amount_eur: increment.amountEur,
  };
}

export interface UsageAccounting
  extends UsageLedger,
    BudgetSource,
    FxRateStore,
    PricingStore {}

export function createUsageAccounting(
  client: DatabaseClient,
  logger: Logger = nullLogger,
): UsageAccounting {
  return {
    async record(row, increments): Promise<LedgerWriteResult> {
      // One database function so the row and the counters it justifies land in
      // the same transaction. Separate round trips would let a counter drift
      // from the ledger, and a drifting counter is a budget that can be
      // walked past.
      const outcome = await client.rpc("record_model_invocation", {
        p_invocation: toInvocationPayload(row),
        p_budget_increments: increments.map(toIncrementPayload),
      });

      if (outcome.error) {
        return { ok: false, detail: outcome.error.code ?? "ledger_write_failed" };
      }

      const id = z.coerce.number().int().safeParse(outcome.data);

      return id.success
        ? { ok: true, id: id.data }
        : { ok: false, detail: "ledger returned no row id" };
    },

    async snapshot({ userIdHash, now }): Promise<readonly BudgetSnapshot[] | null> {
      const outcome = await client.rpc("budget_snapshot", {
        p_user_id_hash: userIdHash,
        p_now: now.toISOString(),
      });

      if (outcome.error) {
        // Null, never an empty list. The gate fails closed on an unreadable
        // counter, and "no limits configured" must not be indistinguishable
        // from "the database is down".
        logger.error("budget.snapshot_unavailable", {
          errorCode: outcome.error.code ?? "unknown",
        });
        return null;
      }

      const parsed = z.array(snapshotRowSchema).safeParse(outcome.data ?? []);
      if (!parsed.success) {
        logger.error("budget.snapshot_malformed", {
          detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
        });
        return null;
      }

      return parsed.data.map((row) => ({
        scope: row.scope,
        scopeKey: row.scope_key,
        limitEur: row.limit_eur,
        spentEur: row.spent_eur,
        warnPct: row.warn_pct,
        degradePct: row.degrade_pct,
      }));
    },

    async latestOnOrBefore(rateDate): Promise<StoredFxRate | null> {
      const outcome = await client
        .from("fx_rates")
        .select("rate, rate_date, source")
        .eq("base_currency", "USD")
        .eq("quote_currency", "EUR")
        .lte("rate_date", rateDate)
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (outcome.error || outcome.data === null) return null;

      const parsed = fxRowSchema.safeParse(outcome.data);
      if (!parsed.success) return null;

      return {
        eurPerUsd: parsed.data.rate,
        rateDate: parsed.data.rate_date.slice(0, 10),
        source: parsed.data.source,
      };
    },

    async latestFor(provider, modelId): Promise<ModelRate | null> {
      const outcome = await client
        .from("model_pricing_snapshots")
        .select("*")
        .eq("provider", provider)
        .eq("model_id", modelId)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (outcome.error || outcome.data === null) return null;

      const parsed = rateRowSchema.safeParse(outcome.data);
      if (!parsed.success) return null;

      return {
        provider: parsed.data.provider,
        modelId: parsed.data.model_id,
        inputRate: parsed.data.input_price_per_token,
        outputRate: parsed.data.output_price_per_token,
        currency: parsed.data.currency,
        fetchedAt: parsed.data.fetched_at,
      };
    },
  };
}

const fetchedRowSchema = z.object({ fetched_at: z.coerce.date() });

/**
 * The daily rate snapshot, written.
 *
 * Its own factory rather than another method on UsageAccounting: that bundle is
 * what the gateway holds on every request, and a request has no business being
 * able to rewrite the exchange rate it is about to be priced at.
 *
 * One row per currency pair per day, replaced on conflict, so a job that runs
 * twice — or runs again after the source publishes later in the day — records
 * the day once rather than twice.
 */
/** The write side of the price table, for the pricing snapshot job. */
export interface PricingSnapshots {
  save(rates: readonly ModelRate[]): Promise<{ ok: true; written: number } | { ok: false; detail: string }>;
}

export function createPricingSnapshots(client: DatabaseClient): PricingSnapshots {
  return {
    async save(rates) {
      if (rates.length === 0) return { ok: true, written: 0 };

      const outcome = await client.from("model_pricing_snapshots").insert(
        rates.map((rate) => ({
          provider: rate.provider,
          model_id: rate.modelId,
          input_price_per_token: rate.inputRate,
          output_price_per_token: rate.outputRate,
          currency: rate.currency,
          fetched_at: rate.fetchedAt.toISOString(),
        })),
      );

      if (outcome.error) return { ok: false, detail: outcome.error.code ?? "insert_failed" };
      return { ok: true, written: rates.length };
    },
  };
}

export function createFxRateSnapshots(client: DatabaseClient): FxRateSnapshots {
  return {
    async lastFetchedAt(): Promise<Date | null> {
      // Ordered by when we asked, not by the date we were told. Before the
      // source publishes today's rate it answers with yesterday's, and a job
      // that keyed off the answer's date would ask again on every page view.
      const outcome = await client
        .from("fx_rates")
        .select("fetched_at")
        .eq("base_currency", "USD")
        .eq("quote_currency", "EUR")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (outcome.error || outcome.data === null) return null;

      const parsed = fetchedRowSchema.safeParse(outcome.data);

      return parsed.success ? parsed.data.fetched_at : null;
    },

    async save(rate: StoredFxRate): Promise<FxWriteResult> {
      const outcome = await client.from("fx_rates").upsert(
        {
          base_currency: "USD",
          quote_currency: "EUR",
          rate: rate.eurPerUsd,
          rate_date: rate.rateDate,
          source: rate.source,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "base_currency,quote_currency,rate_date" },
      );

      return outcome.error
        ? { ok: false, detail: outcome.error.code ?? "fx_write_failed" }
        : { ok: true };
    },
  };
}
