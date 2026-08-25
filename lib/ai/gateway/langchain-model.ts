import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";

import { createAccountant, type Accountant } from "@/lib/ai/gateway/accounting";
import type { TurnBudget } from "@/lib/ai/gateway/budgeter";
import { createFxRateService } from "@/lib/ai/gateway/fx";
import {
  createModelRegistry,
  registryOverridesFromEnv,
} from "@/lib/ai/gateway/registry";
import { routeFor, type TaskId, type Tier } from "@/lib/ai/tasks";
import { requireEnvValue, type AppEnv } from "@/lib/env/schema";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { UsageAccounting } from "@/repositories/usage-repository";

/**
 * The LangChain face of the gateway, for the Trainer's agent loop.
 *
 * The Trainer runs a tool-calling agent, and the gateway's own transport
 * deliberately cannot express one: it speaks exactly two roles and no tools,
 * because the tutor pipeline needs nothing more. Rather than widen the most
 * guarded interface in the codebase for one feature, this file builds a
 * LangChain chat model inside the gateway boundary — the only place a model
 * SDK may live — with the same discipline every other call gets:
 *
 *   - the model id comes from the registry, resolved by tier, never named here
 *   - the tier and both token ceilings come from the task table
 *   - every LLM invocation writes exactly one ledger row, success or failure,
 *     through the same accountant the chat gateway uses
 *   - a per-request euro budget stops the loop before its next iteration
 *
 * The security suite allowlists this file as the fourth connection-opener in
 * lib/ai; the connections themselves are made by the OpenAI SDK under
 * LangChain, pointed at OpenRouter.
 */

export const TRAINER_TASK: TaskId = "trainer.session";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const PROVIDER = "openrouter";
const CALL_TIMEOUT_MS = 30_000;

/** Which catalogue prompt this model is speaking for, stamped on ledger rows. */
export interface PromptIdentity {
  readonly name: string;
  readonly version: number;
  readonly fingerprint: string;
}

export interface TrainerModelDeps {
  readonly env: AppEnv;
  /** The secret-key accounting bundle: ledger, budgets, pricing, fx in one. */
  readonly accounting: UsageAccounting;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface TrainerModelContext {
  readonly requestId: string;
  readonly userIdHash: string;
  /** The per-request euro ceiling; every invocation records into it. */
  readonly turn: TurnBudget;
  readonly prompt: PromptIdentity;
}

export interface TrainerModel {
  readonly model: BaseChatModel;
  readonly modelId: string;
  readonly tier: Tier;
}

/** Thrown between iterations once the request's euro ceiling is spent. */
export class TrainerBudgetExhausted extends Error {
  constructor(maxEur: number) {
    super(`the trainer request reached its ${maxEur} euro ceiling`);
    this.name = "TrainerBudgetExhausted";
  }
}

interface UsageFigures {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly reportedUsd: number | null;
  readonly modelIdResolved: string | null;
}

/** The provider's own usage block, as OpenRouter sends it back. */
interface ProviderUsage {
  readonly prompt_tokens?: unknown;
  readonly completion_tokens?: unknown;
  readonly cost?: unknown;
  readonly prompt_tokens_details?: { readonly cached_tokens?: unknown };
  readonly completion_tokens_details?: { readonly reasoning_tokens?: unknown };
}

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;

/**
 * Reads what the provider said a call cost.
 *
 * Not from llmOutput, which is where you would look first and where there is
 * nothing to find: @langchain/openai builds it as `{ tokenUsage }` and drops
 * every other field of the response, so OpenRouter's dollar figure never
 * arrives there however politely the request asks for it. Reading it from
 * there is why every Trainer call in the ledger was recorded as free.
 *
 * The raw block survives on the generation's message instead, under
 * response_metadata.usage — cost, cached prompt tokens and reasoning tokens
 * all of it — and that is what this reads, with llmOutput.tokenUsage kept as
 * the fallback for the counts alone. Verified against @langchain/openai 1.5.
 *
 * The block describes the response, not one choice within it, and the SDK
 * copies it onto every generation. Read once, from the first, or a model
 * asked for two candidates bills twice.
 */
function usageFrom(output: LLMResult): UsageFigures {
  const metadata = (
    output.generations?.[0]?.[0] as { message?: { response_metadata?: unknown } } | undefined
  )?.message?.response_metadata as
    | { usage?: ProviderUsage; model_name?: unknown }
    | undefined;

  const usage = metadata?.usage ?? {};
  const counted = (output.llmOutput ?? {}) as {
    tokenUsage?: { promptTokens?: unknown; completionTokens?: unknown };
  };

  const cost = usage.cost;
  const model = metadata?.model_name;

  return {
    inputTokens:
      whole(usage.prompt_tokens) ?? whole(counted.tokenUsage?.promptTokens) ?? 0,
    outputTokens:
      whole(usage.completion_tokens) ?? whole(counted.tokenUsage?.completionTokens) ?? 0,
    // Null rather than zero: the ledger distinguishes a model that reported no
    // reasoning tokens from one that was never asked.
    reasoningTokens: whole(usage.completion_tokens_details?.reasoning_tokens),
    cachedInputTokens: whole(usage.prompt_tokens_details?.cached_tokens),
    reportedUsd: typeof cost === "number" && cost >= 0 ? cost : null,
    modelIdResolved: typeof model === "string" && model.length > 0 ? model : null,
  };
}

/**
 * One ledger row per LLM invocation, written from inside the loop.
 *
 * A callback rather than a wrapper, because the agent framework owns the call
 * sites: this is the one seam every invocation passes through. `raiseError`
 * is set so the budget check in handleLLMStart genuinely stops the run rather
 * than being logged and ignored.
 */
class LedgerCallback extends BaseCallbackHandler {
  name = "trainer-ledger";
  raiseError = true;

  private attempts = 0;
  private readonly startedAt = new Map<string, number>();

  constructor(
    private readonly accountant: Accountant,
    private readonly context: TrainerModelContext,
    private readonly identity: {
      readonly tier: Tier;
      readonly modelId: string;
      readonly maxOutputTokens: number;
    },
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {
    super();
  }

  override async handleLLMStart(
    _llm: unknown,
    _prompts: string[],
    runId: string,
  ): Promise<void> {
    if (this.context.turn.remainingEur() <= 0) {
      throw new TrainerBudgetExhausted(this.context.turn.maxEur);
    }
    this.startedAt.set(runId, this.now().getTime());
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    await this.record(runId, "ok", null, usageFrom(output));
  }

  override async handleLLMError(error: unknown, runId: string): Promise<void> {
    // The budget refusal above arrives here too; it already spent nothing and
    // needs no second row saying so.
    if (error instanceof TrainerBudgetExhausted) return;

    await this.record(runId, "error", errorNameFor(error), {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: null,
      cachedInputTokens: null,
      reportedUsd: null,
      modelIdResolved: null,
    });
  }

  private async record(
    runId: string,
    status: "ok" | "error",
    errorCode: string | null,
    usage: UsageFigures,
  ): Promise<void> {
    this.attempts += 1;
    const started = this.startedAt.get(runId);
    this.startedAt.delete(runId);

    const priced = await this.accountant.price(
      usage.reportedUsd,
      PROVIDER,
      this.identity.modelId,
      usage,
    );
    this.context.turn.record(priced.costEur);

    await this.accountant.write({
      requestId: this.context.requestId,
      traceId: null,
      spanId: null,
      userIdHash: this.context.userIdHash,
      threadId: null,
      messageId: null,
      task: TRAINER_TASK,
      tier: this.identity.tier,
      promptName: this.context.prompt.name,
      promptVersion: this.context.prompt.version,
      promptFingerprint: this.context.prompt.fingerprint,
      provider: PROVIDER,
      modelId: this.identity.modelId,
      modelIdResolved: usage.modelIdResolved ?? this.identity.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      maxOutputTokens: this.identity.maxOutputTokens,
      truncated: false,
      escalated: false,
      degraded: false,
      budgetScopeHit: null,
      attemptNumber: this.attempts,
      latencyMs: started === undefined ? null : this.now().getTime() - started,
      firstTokenMs: null,
      status,
      errorCode,
      costUsd: priced.costUsd,
      fxRateEurPerUsd: priced.fxRateEurPerUsd,
      fxStale: priced.fxStale,
      costEur: priced.costEur,
    });

    this.logger.info("trainer.model_call", {
      requestId: this.context.requestId,
      userIdHash: this.context.userIdHash,
      status,
      attempt: this.attempts,
      costEur: Number(priced.costEur.toFixed(8)),
    });
  }
}

/** Never the provider's message — it can quote the prompt back. */
function errorNameFor(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) return error.name.slice(0, 64);
  return "unknown_error";
}

/**
 * True for the failure that means "this model, not this request": OpenRouter
 * answers 404 when no endpoint serves the model under the account's privacy
 * and guardrail settings (its data policy filters the endpoint pool). The
 * next same-tier candidate may still be served — the transport walks the same
 * ladder for the tutor, and the Trainer deserves the same resilience.
 */
export function isModelUnavailableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, lc_error_code: code } = error as {
    status?: unknown;
    lc_error_code?: unknown;
  };
  return status === 404 || code === "MODEL_NOT_FOUND";
}

/**
 * The tier's whole ladder — the primary first, then the registry's same-tier
 * fallbacks, each a ready model with its own ledger callback. The caller
 * tries them in order when one is unavailable; every attempt still writes
 * its rows, because a failed call costs latency and must be visible.
 */
export function createTrainerModelLadder(
  deps: TrainerModelDeps,
  context: TrainerModelContext,
): readonly TrainerModel[] {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());

  const apiKey = requireEnvValue(deps.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");
  const route = routeFor(TRAINER_TASK);
  const registry = createModelRegistry(registryOverridesFromEnv(deps.env));

  const accountant = createAccountant({
    ledger: deps.accounting,
    fx: createFxRateService(deps.accounting, {
      logger,
      bootstrap: deps.env.FX_EUR_PER_USD_BOOTSTRAP
        ? { eurPerUsd: deps.env.FX_EUR_PER_USD_BOOTSTRAP, source: "configured" }
        : undefined,
    }),
    pricing: deps.accounting,
    logger,
    now,
  });

  return registry.candidates(route.tier).map((modelId): TrainerModel => {
    const model = new ChatOpenAI({
      apiKey,
      model: modelId,
      maxTokens: route.maxOutputTokens,
      timeout: CALL_TIMEOUT_MS,
      maxRetries: 1,
      configuration: {
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
          "HTTP-Referer": deps.env.APP_URL,
          "X-Title": deps.env.APP_NAME,
        },
      },
      // Asks OpenRouter to attach its own dollar figure to the usage block.
      modelKwargs: { usage: { include: true } },
      callbacks: [
        new LedgerCallback(
          accountant,
          context,
          {
            tier: route.tier,
            modelId,
            maxOutputTokens: route.maxOutputTokens,
          },
          logger,
          now,
        ),
      ],
    });

    return { model, modelId, tier: route.tier };
  });
}

/** The tier's primary alone, for callers that need exactly one model. */
export function createTrainerChatModel(
  deps: TrainerModelDeps,
  context: TrainerModelContext,
): TrainerModel {
  return createTrainerModelLadder(deps, context)[0];
}
