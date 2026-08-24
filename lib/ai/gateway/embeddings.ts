import { z } from "zod";

import { createAccountant, type AccountantDeps } from "@/lib/ai/gateway/accounting";
import {
  evaluateBudgets,
  type BudgetScope,
  type BudgetSource,
} from "@/lib/ai/gateway/budget-gate";
import {
  errorCodeFor,
  gatewayFail,
  gatewayOk,
  statusForFailure,
  type GatewayFailure,
  type GatewayResult,
} from "@/lib/ai/gateway/errors";
import type { LedgerRow } from "@/lib/ai/gateway/ledger";
import type { ModelRegistry } from "@/lib/ai/gateway/registry";
import { resolveTask } from "@/lib/ai/gateway/router";
import { estimateTokens } from "@/lib/ai/prompts/tokens";
import { nullLogger, type Logger } from "@/lib/observability/logger";

/**
 * Embeddings.
 *
 * A separate gateway rather than another method on the chat one, because the
 * two share almost nothing at the dispatch layer: there is no output ceiling
 * to enforce, no stream to guard, no fallback ladder worth walking — a second
 * embedding model would produce vectors incomparable with everything already
 * stored — and the unit of work is a batch rather than a turn.
 *
 * What they do share is the part that matters: the same budget gate, the same
 * ledger, the same conversion, through the same accountant. An embedding call
 * is a model call, so it is routed, budgeted and accounted for like any other.
 */

export const EMBEDDING_TASKS = ["ingestion.embedding", "retrieval.embedding"] as const;
export const embeddingTaskSchema = z.enum(EMBEDDING_TASKS);
export type EmbeddingTask = z.infer<typeof embeddingTaskSchema>;

export interface EmbeddingRequest {
  readonly modelId: string;
  readonly texts: readonly string[];
  readonly dimensions: number;
  readonly signal: AbortSignal;
}

export interface EmbeddingUsage {
  readonly inputTokens: number;
  readonly costUsd: number | null;
  readonly modelIdResolved: string;
}

export interface EmbeddingResponse {
  /** One vector per input, in the order the inputs were given. */
  readonly vectors: readonly (readonly number[])[];
  readonly usage: EmbeddingUsage;
}

export interface EmbeddingTransport {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

const MAX_TIMEOUT_MS = 120_000;

export const embeddingCallSpecSchema = z
  .strictObject({
    task: embeddingTaskSchema,
    tier: z.literal("embedding"),
    maxInputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    dimensions: z.number().int().positive(),
    /** A batch bound, so one oversized ingestion run is not one enormous request. */
    maxBatchSize: z.number().int().positive().max(512),
  })
  .superRefine((spec, ctx) => {
    const route = resolveTask(spec.task);
    if (!route.ok) return;

    if (spec.maxInputTokens > route.data.maxInputTokens) {
      ctx.addIssue({
        code: "custom",
        path: ["maxInputTokens"],
        message: `${spec.task} may consume at most ${route.data.maxInputTokens} tokens per text`,
      });
    }
  });

export type EmbeddingCallSpec = z.infer<typeof embeddingCallSpecSchema>;

/** A batch this size keeps a request well inside every provider's own limit. */
export const DEFAULT_EMBEDDING_BATCH = 96;

export interface EmbeddingSpecOptions {
  readonly timeoutMs: number;
  readonly dimensions: number;
  readonly maxBatchSize?: number;
}

export function embeddingSpecFor(
  task: unknown,
  options: EmbeddingSpecOptions,
): GatewayResult<EmbeddingCallSpec> {
  const route = resolveTask(task);
  if (!route.ok) return route;

  const parsed = embeddingCallSpecSchema.safeParse({
    task: route.data.task,
    tier: route.data.tier,
    maxInputTokens: route.data.maxInputTokens,
    timeoutMs: options.timeoutMs,
    dimensions: options.dimensions,
    maxBatchSize: options.maxBatchSize ?? DEFAULT_EMBEDDING_BATCH,
  });

  return parsed.success
    ? gatewayOk(parsed.data)
    : gatewayFail(
        "invalid_spec",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; "),
      );
}

export interface EmbeddingContext {
  readonly requestId: string | null;
  readonly traceId?: string | null;
  readonly spanId?: string | null;
  readonly userIdHash?: string | null;
}

export interface EmbeddingOutcome {
  readonly vectors: readonly (readonly number[])[];
  readonly modelIdResolved: string;
  readonly inputTokens: number;
  readonly costUsd: number;
  readonly costEur: number;
}

export interface EmbeddingGateway {
  embed(
    spec: EmbeddingCallSpec,
    texts: readonly string[],
    context: EmbeddingContext,
  ): Promise<GatewayResult<EmbeddingOutcome>>;
}

export interface EmbeddingGatewayDeps extends AccountantDeps {
  readonly registry: ModelRegistry;
  readonly transport: EmbeddingTransport;
  readonly budgets: BudgetSource;
}

export function createEmbeddingGateway(
  deps: EmbeddingGatewayDeps,
): EmbeddingGateway {
  const logger: Logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());
  const account = createAccountant(deps);

  function row(
    spec: EmbeddingCallSpec,
    context: EmbeddingContext,
    over: Partial<LedgerRow>,
  ): LedgerRow {
    const entry = deps.registry.forTier("embedding");

    return {
      requestId: context.requestId,
      traceId: context.traceId ?? null,
      spanId: context.spanId ?? null,
      userIdHash: context.userIdHash ?? null,
      threadId: null,
      messageId: null,
      task: spec.task,
      tier: "embedding",
      promptName: null,
      promptVersion: null,
      promptFingerprint: null,
      provider: entry.provider,
      modelId: entry.modelId,
      modelIdResolved: entry.modelId,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: null,
      cachedInputTokens: null,
      // An embedding emits a vector. There is no output ceiling to state.
      maxOutputTokens: 0,
      truncated: false,
      escalated: false,
      degraded: false,
      budgetScopeHit: null,
      attemptNumber: 1,
      latencyMs: null,
      firstTokenMs: null,
      status: "ok",
      errorCode: null,
      costUsd: 0,
      fxRateEurPerUsd: null,
      fxStale: true,
      costEur: 0,
      ...over,
    };
  }

  return {
    async embed(spec, texts, context) {
      const parsed = embeddingCallSpecSchema.safeParse(spec);
      if (!parsed.success) {
        return gatewayFail(
          "invalid_spec",
          parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; "),
        );
      }

      const valid = parsed.data;
      if (texts.length === 0) {
        return gatewayOk({
          vectors: [],
          modelIdResolved: deps.registry.forTier("embedding").modelId,
          inputTokens: 0,
          costUsd: 0,
          costEur: 0,
        });
      }

      if (texts.length > valid.maxBatchSize) {
        return gatewayFail(
          "invalid_spec",
          `${texts.length} texts exceeds the batch size of ${valid.maxBatchSize}`,
        );
      }

      // Layer 1, per text rather than per batch: the ceiling is what one text
      // may be, and a chunk over it is a chunking bug the caller has to fix
      // rather than something to silently truncate into a wrong vector.
      const oversized = texts.findIndex(
        (text) => estimateTokens(text) > valid.maxInputTokens,
      );
      if (oversized !== -1) {
        await account.write(
          row(valid, context, { status: "ceiling_denied", errorCode: "input_ceiling" }),
        );
        return gatewayFail(
          "ceiling_denied",
          `text ${oversized} exceeds the ${valid.maxInputTokens} token ceiling`,
        );
      }

      let snapshots: Awaited<ReturnType<BudgetSource["snapshot"]>> = null;
      try {
        snapshots = await deps.budgets.snapshot({
          userIdHash: context.userIdHash ?? null,
          now: now(),
        });
      } catch (error) {
        logger.error("budget.snapshot_failed", { errorCode: errorCodeFor(error) });
      }

      const decision = evaluateBudgets(snapshots);

      if (decision.state === "deny") {
        await account.write(
          row(valid, context, {
            status: "budget_denied",
            errorCode: "budget",
            budgetScopeHit: decision.scope as BudgetScope | null,
          }),
        );
        logger.warn("budget.denied", {
          audit: true,
          task: valid.task,
          scope: decision.scope,
          detail: decision.detail,
        });
        return gatewayFail("budget_denied", decision.detail);
      }

      const entry = deps.registry.forTier("embedding");
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), valid.timeoutMs);
      const started = Date.now();

      try {
        const response = await deps.transport.embed({
          modelId: entry.modelId,
          texts,
          dimensions: valid.dimensions,
          signal: abort.signal,
        });

        if (response.vectors.length !== texts.length) {
          throw new Error("embedding provider returned a different number of vectors");
        }

        const wrongWidth = response.vectors.findIndex(
          (vector) => vector.length !== valid.dimensions,
        );
        if (wrongWidth !== -1) {
          // A vector of the wrong width silently poisons every similarity
          // score it later takes part in, so it never reaches the database.
          throw new Error("embedding provider returned a vector of the wrong width");
        }

        const priced = await account.price(
          response.usage.costUsd,
          entry.provider,
          entry.modelId,
          { inputTokens: response.usage.inputTokens, outputTokens: 0 },
        );

        await account.write(
          row(valid, context, {
            modelIdResolved: response.usage.modelIdResolved,
            inputTokens: response.usage.inputTokens,
            latencyMs: Date.now() - started,
            status: "ok",
            ...priced,
          }),
        );

        return gatewayOk({
          vectors: response.vectors,
          modelIdResolved: response.usage.modelIdResolved,
          inputTokens: response.usage.inputTokens,
          costUsd: priced.costUsd,
          costEur: priced.costEur,
        });
      } catch (error) {
        const failure: GatewayFailure = abort.signal.aborted
          ? "timeout"
          : "provider_error";

        await account.write(
          row(valid, context, {
            status: statusForFailure(failure) ?? "error",
            errorCode: errorCodeFor(error),
            latencyMs: Date.now() - started,
          }),
        );

        return gatewayFail(failure, errorCodeFor(error));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
