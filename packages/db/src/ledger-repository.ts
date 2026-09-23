import { z } from "zod";

import { tierSchema } from "@dp/domain/tasks";

import { fail, ok, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput, decodeRows } from "./result";
import type { DatabaseClient, QueryBuilder } from "./types";

/**
 * The usage ledger, one call at a time.
 *
 * The explorer an operator reaches for when an aggregate needs explaining:
 * why this task failed, what that learner was denied, which retries one turn
 * took. Read-only by construction — `model_invocations` is append-only by
 * trigger, and a correction is a new row.
 *
 * Every read is bounded. The cost dashboard spec forbids scanning the raw
 * ledger for a historical view, so a window longer than a month is refused
 * rather than served slowly; the daily rollup is the tool for the year. Pages
 * are keyset, by id, because an offset over a table that grows while the
 * operator is reading it skips and repeats rows.
 *
 * Nothing here carries content. The ledger holds a pseudonym and ids, never a
 * message, which is why a single row is safe to render at all.
 */

export const INVOCATION_STATUSES = [
  "ok",
  "error",
  "timeout",
  "budget_denied",
  "ceiling_denied",
] as const;

export const invocationStatusSchema = z.enum(INVOCATION_STATUSES);
export type InvocationStatus = z.infer<typeof invocationStatusSchema>;

export const LEDGER_PAGE_SIZE = 50;

/** The longest window one read may cover. */
export const LEDGER_MAX_WINDOW_DAYS = 31;

/** How many attempts of one request the detail view lists. */
const REQUEST_ATTEMPTS_SHOWN = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

const numeric = z.coerce.number();
const count = z.coerce.number().int().min(0);

/** Every column the explorer reads. Exported for the schema contract test. */
export const LEDGER_COLUMNS = [
  "id",
  "created_at",
  "request_id",
  "trace_id",
  "user_id_hash",
  "thread_id",
  "message_id",
  "task",
  "tier",
  "prompt_name",
  "prompt_version",
  "provider",
  "model_id",
  "model_id_resolved",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cached_input_tokens",
  "max_output_tokens",
  "truncated",
  "escalated",
  "degraded",
  "budget_scope_hit",
  "attempt_number",
  "latency_ms",
  "first_token_ms",
  "status",
  "error_code",
  "cost_usd",
  "fx_rate_eur_per_usd",
  "fx_stale",
  "cost_eur",
].join(", ");

export const invocationSchema = z
  .object({
    id: z.coerce.number().int(),
    created_at: z.coerce.date(),
    request_id: z.string().nullable(),
    trace_id: z.string().nullable(),
    user_id_hash: z.string().nullable(),
    thread_id: z.string().nullable(),
    message_id: z.string().nullable(),
    task: z.string(),
    tier: tierSchema,
    prompt_name: z.string().nullable(),
    prompt_version: z.coerce.number().int().nullable(),
    provider: z.string(),
    model_id: z.string(),
    model_id_resolved: z.string(),
    input_tokens: count,
    output_tokens: count,
    reasoning_tokens: count.nullable(),
    cached_input_tokens: count.nullable(),
    max_output_tokens: count,
    truncated: z.boolean(),
    escalated: z.boolean(),
    degraded: z.boolean(),
    budget_scope_hit: z.string().nullable(),
    attempt_number: z.coerce.number().int().min(1),
    latency_ms: count.nullable(),
    first_token_ms: count.nullable(),
    status: invocationStatusSchema,
    error_code: z.string().nullable(),
    cost_usd: numeric.min(0),
    fx_rate_eur_per_usd: numeric.positive().nullable(),
    fx_stale: z.boolean(),
    cost_eur: numeric.min(0),
  })
  .transform((row) => ({
    id: row.id,
    createdAt: row.created_at,
    requestId: row.request_id,
    traceId: row.trace_id,
    userIdHash: row.user_id_hash,
    threadId: row.thread_id,
    messageId: row.message_id,
    task: row.task,
    tier: row.tier,
    promptName: row.prompt_name,
    promptVersion: row.prompt_version,
    provider: row.provider,
    /** What the registry asked for. */
    modelId: row.model_id,
    /** What the provider ran and billed. */
    modelIdResolved: row.model_id_resolved,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    cachedInputTokens: row.cached_input_tokens,
    maxOutputTokens: row.max_output_tokens,
    truncated: row.truncated,
    escalated: row.escalated,
    degraded: row.degraded,
    budgetScopeHit: row.budget_scope_hit,
    attemptNumber: row.attempt_number,
    latencyMs: row.latency_ms,
    firstTokenMs: row.first_token_ms,
    status: row.status,
    errorCode: row.error_code,
    costUsd: row.cost_usd,
    /** Null on a row written before any rate existed; its euro cost is then zero. */
    fxRateEurPerUsd: row.fx_rate_eur_per_usd,
    fxStale: row.fx_stale,
    costEur: row.cost_eur,
  }));

export type Invocation = z.infer<typeof invocationSchema>;

const flag = z.literal(true).optional();

export const ledgerFilterSchema = z
  .object({
    from: z.date(),
    to: z.date(),
    status: invocationStatusSchema.optional(),
    task: z.string().min(1).max(120).optional(),
    tier: tierSchema.optional(),
    modelIdResolved: z.string().min(1).max(200).optional(),
    userIdHash: z.string().regex(/^[0-9a-f]{32}$/).optional(),
    requestId: z.uuid().optional(),
    truncated: flag,
    degraded: flag,
    escalated: flag,
    fxStale: flag,
    /** The keyset cursor: rows with an id below this one. */
    before: z.number().int().positive().optional(),
  })
  .refine((filter) => filter.from < filter.to, { message: "the window must run forwards" })
  .refine(
    (filter) => filter.to.getTime() - filter.from.getTime() <= LEDGER_MAX_WINDOW_DAYS * DAY_MS,
    { message: `at most ${LEDGER_MAX_WINDOW_DAYS} days; use the daily rollup for longer` },
  );

export type LedgerFilter = z.input<typeof ledgerFilterSchema>;

export interface LedgerPage {
  readonly rows: readonly Invocation[];
  /** Pass as `before` for the next page; null on the last one. */
  readonly nextBefore: number | null;
}

export interface LedgerCall {
  readonly call: Invocation;
  /** Every attempt that shared this call's request id, oldest first, itself included. */
  readonly request: readonly Invocation[];
}

export interface LedgerRepository {
  list(filter: LedgerFilter): Promise<RepositoryResult<LedgerPage>>;
  get(id: number): Promise<RepositoryResult<LedgerCall>>;
}

export function createLedgerRepository(client: DatabaseClient): LedgerRepository {
  return {
    async list(filter) {
      const parsed = decodeInput(filter, ledgerFilterSchema);
      if (!parsed.ok) return parsed;
      const f = parsed.data;

      let query: QueryBuilder = client
        .from("model_invocations")
        .select(LEDGER_COLUMNS)
        .gte("created_at", f.from.toISOString())
        .lt("created_at", f.to.toISOString());

      const equal: ReadonlyArray<readonly [string, unknown]> = [
        ["status", f.status],
        ["task", f.task],
        ["tier", f.tier],
        ["model_id_resolved", f.modelIdResolved],
        ["user_id_hash", f.userIdHash],
        ["request_id", f.requestId],
        ["truncated", f.truncated],
        ["degraded", f.degraded],
        ["escalated", f.escalated],
        ["fx_stale", f.fxStale],
      ];
      for (const [column, value] of equal) {
        if (value !== undefined) query = query.eq(column, value);
      }
      if (f.before !== undefined) query = query.lt("id", f.before);

      const outcome = await query.order("id", { ascending: false }).limit(LEDGER_PAGE_SIZE + 1);

      const rows = decodeRows(outcome, invocationSchema);
      if (!rows.ok) return rows;

      const page = rows.data.slice(0, LEDGER_PAGE_SIZE);
      const more = rows.data.length > LEDGER_PAGE_SIZE;

      return ok({ rows: page, nextBefore: more ? (page.at(-1)?.id ?? null) : null });
    },

    async get(id) {
      const parsedId = decodeInput(id, z.number().int().positive());
      if (!parsedId.ok) return parsedId;

      const found = decodeRows(
        await client.from("model_invocations").select(LEDGER_COLUMNS).eq("id", parsedId.data).limit(1),
        invocationSchema,
      );
      if (!found.ok) return found;

      const call = found.data.find((row) => row.id === parsedId.data);
      if (call === undefined) return fail(repositoryError("not_found"));
      if (call.requestId === null) return ok({ call, request: [call] });

      const siblings = decodeRows(
        await client
          .from("model_invocations")
          .select(LEDGER_COLUMNS)
          .eq("request_id", call.requestId)
          .order("id", { ascending: true })
          .limit(REQUEST_ATTEMPTS_SHOWN),
        invocationSchema,
      );

      // The call itself is shown whatever happens to the second read: a detail
      // page that loses its subject because a neighbour did not load is worse
      // than one that shows fewer neighbours.
      return ok({ call, request: siblings.ok && siblings.data.length > 0 ? siblings.data : [call] });
    },
  };
}
