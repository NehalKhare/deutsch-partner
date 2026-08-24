import { z } from "zod";

import { budgetScopeSchema, type BudgetScope } from "@/lib/ai/gateway/budget-gate";
import { ledgerStatusSchema } from "@/lib/ai/gateway/errors";
import type { FxRate } from "@/lib/ai/gateway/fx";
import { taskIdSchema, tierSchema } from "@/lib/ai/tasks";

/**
 * The usage ledger row.
 *
 * One per model call, written on success and on failure alike, because a
 * failed call that produced tokens still cost money. The gateway writes it;
 * callers never touch a provider, which is what makes accounting unskippable
 * rather than merely expected.
 *
 * Note what the shape does not have: any field that could hold what a learner
 * or a model said. The schema is strict, so attaching one is a validation
 * failure rather than a quiet leak of conversation content into a financial
 * record that deliberately outlives the conversation.
 */

const identifier = (max: number) => z.string().min(1).max(max);

export const ledgerRowSchema = z
  .strictObject({
    requestId: z.uuid().nullable(),
    traceId: identifier(128).nullable(),
    spanId: identifier(128).nullable(),
    /** Pseudonymous. The ledger outlives the account, so it holds no user id. */
    userIdHash: identifier(128).nullable(),
    threadId: z.uuid().nullable(),
    messageId: z.uuid().nullable(),

    task: taskIdSchema,
    tier: tierSchema,
    promptName: identifier(120).nullable(),
    promptVersion: z.number().int().positive().nullable(),
    promptFingerprint: identifier(32).nullable(),

    provider: identifier(64),
    modelId: identifier(160),
    /** What the router actually served. Not always what was asked for. */
    modelIdResolved: identifier(160),

    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    reasoningTokens: z.number().int().min(0).nullable(),
    cachedInputTokens: z.number().int().min(0).nullable(),

    maxOutputTokens: z.number().int().min(0),
    truncated: z.boolean(),
    escalated: z.boolean(),
    degraded: z.boolean(),
    budgetScopeHit: budgetScopeSchema.nullable(),
    attemptNumber: z.number().int().min(1),

    latencyMs: z.number().int().min(0).nullable(),
    firstTokenMs: z.number().int().min(0).nullable(),
    status: ledgerStatusSchema,
    errorCode: identifier(64).nullable(),

    costUsd: z.number().min(0),
    fxRateEurPerUsd: z.number().positive().nullable(),
    fxStale: z.boolean(),
    costEur: z.number().min(0),
  })
  .refine(
    (row) => (row.tier === "embedding" || row.tier === "tts") === (row.maxOutputTokens === 0),
    {
      // A chat call with no output ceiling is a misconfiguration; an embedding
      // with one is a category error. Neither should be recordable.
      error: "only an embedding or speech call has a zero output ceiling",
      path: ["maxOutputTokens"],
    },
  )
  .refine(
    (row) => row.fxRateEurPerUsd !== null || (row.costEur === 0 && row.fxStale),
    {
      // A euro figure with no stated rate is not auditable, and the dashboard
      // has to be able to show the rate and date behind every number.
      error:
        "a row with no fx rate must declare itself unpriced: cost_eur zero and fx_stale set",
      path: ["fxRateEurPerUsd"],
    },
  );

export type LedgerRow = z.infer<typeof ledgerRowSchema>;

export interface BudgetIncrement {
  readonly scope: BudgetScope;
  readonly scopeKey: string | null;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly amountEur: number;
}

export type LedgerWriteResult =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly detail: string };

export interface UsageLedger {
  /**
   * Writes the row and applies the counter increments in one transaction. A
   * counter that can drift from the ledger is a budget that can be walked past.
   */
  record(
    row: LedgerRow,
    increments: readonly BudgetIncrement[],
  ): Promise<LedgerWriteResult>;
}

export interface PricedCall {
  readonly costUsd: number;
  readonly fxRateEurPerUsd: number | null;
  readonly fxStale: boolean;
  readonly costEur: number;
}

/**
 * Converts once, at write time, and keeps the rate on the row.
 *
 * The stored euro figure is never recomputed on read. When no rate exists the
 * dollars are still exact and the row says it could not be priced, which is
 * the honest answer and is visible on the dashboard.
 */
export function applyFx(costUsd: number, rate: FxRate | null): PricedCall {
  if (rate === null) {
    return { costUsd, fxRateEurPerUsd: null, fxStale: true, costEur: 0 };
  }

  const SCALE = 1e8;

  return {
    costUsd,
    fxRateEurPerUsd: rate.eurPerUsd,
    fxStale: rate.stale,
    costEur: Math.round(costUsd * rate.eurPerUsd * SCALE) / SCALE,
  };
}
