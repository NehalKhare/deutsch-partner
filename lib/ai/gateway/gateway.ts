import {
  evaluateBudgets,
  type BudgetDecision,
  type BudgetSource,
  type BudgetScope,
} from "@/lib/ai/gateway/budget-gate";
import { preflight, type TurnBudget } from "@/lib/ai/gateway/budgeter";
import {
  CONVERSATION_TASKS,
  modelCallSpecSchema,
  withLoweredOutputCeiling,
  type ModelCallSpec,
} from "@/lib/ai/gateway/call-spec";
import {
  errorCodeFor,
  gatewayFail,
  gatewayOk,
  statusForFailure,
  type GatewayFailure,
  type GatewayResult,
  type LedgerStatus,
} from "@/lib/ai/gateway/errors";
import { createAccountant } from "@/lib/ai/gateway/accounting";
import { applyFx, type LedgerRow, type UsageLedger } from "@/lib/ai/gateway/ledger";
import type { FxRateService } from "@/lib/ai/gateway/fx";
import { estimateUsd, resolveRate, type PricingStore } from "@/lib/ai/gateway/pricing";
import { downgradeTier, type ModelRegistry } from "@/lib/ai/gateway/registry";
import { guardStream, type StreamGuardResult } from "@/lib/ai/gateway/stream-guard";
import type {
  Citation,
  CompletionResponse,
  ModelRequest,
  ModelTransport,
  ProviderUsage,
  StreamResponse,
} from "@/lib/ai/gateway/transport";
import { webSearchFor, type Tier } from "@/lib/ai/tasks";
import { nullLogger, type Logger } from "@/lib/observability/logger";

/**
 * The model gateway.
 *
 * The only thing in the application permitted to call a model, which is what
 * makes every guarantee below unconditional rather than customary: ceilings
 * are enforced on the way in, output is bounded on the way out, budgets are
 * checked before dispatch and fail closed, and exactly one ledger row is
 * written per call whether it succeeded, failed, timed out or was refused.
 *
 * Callers hand it a spec and an assembled prompt. They do not choose a model,
 * a tier, or a ceiling, and they cannot skip the accounting, because there is
 * no path to a provider that goes around this file.
 */

/**
 * Re-exported because it is part of what a caller reads off an outcome, and
 * the module it is declared in is behind the boundary a CI test enforces: a
 * caller holding a ModelTransport could dispatch without a spec, a budget
 * check or a ledger row. The type travels; the transport does not.
 */
export type { Citation } from "@/lib/ai/gateway/transport";

export interface GatewayPrompt {
  readonly system: string;
  /**
   * The leading part of `system` the builder promises is byte-identical on
   * every call of this task — the versioned blocks, not caller data. Optional
   * because a prompt assembled outside the catalogue makes no such promise.
   */
  readonly systemStable?: string;
  readonly user: string;
  /** Counted by the prompt builder. Checked here before anything is sent. */
  readonly inputTokens: number;
}

export interface PromptIdentity {
  readonly name: string;
  readonly version: number;
  readonly fingerprint: string;
}

export interface CallContext {
  readonly requestId: string | null;
  readonly traceId?: string | null;
  readonly spanId?: string | null;
  readonly userIdHash: string | null;
  readonly threadId?: string | null;
  readonly messageId?: string | null;
  /** The per-request euro accumulator for the turn this call belongs to. */
  readonly turn?: TurnBudget;
  readonly prompt?: PromptIdentity;
}

export interface CompletionOutcome {
  readonly text: string;
  readonly truncated: boolean;
  readonly degraded: boolean;
  readonly tier: Tier;
  readonly modelIdResolved: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly costEur: number;
  readonly attempts: number;
  readonly ledgerId: number | null;
  /**
   * The sources the provider says it consulted, empty for the great majority
   * of calls that searched for nothing. Always an array, so a caller never has
   * to tell an absent field from an empty one.
   *
   * Untrusted, like anything else that came from outside: a citation is fenced
   * before it reaches another prompt, and its scheme is checked before it is
   * rendered as a link.
   */
  readonly citations: readonly Citation[];
}

export interface StreamOutcome {
  readonly chunks: AsyncIterable<string>;
  /** Resolves once the stream is exhausted and the ledger row is written. */
  readonly settled: Promise<CompletionOutcome>;
  readonly tier: Tier;
  readonly degraded: boolean;
}

export interface ModelGateway {
  complete(
    spec: ModelCallSpec,
    prompt: GatewayPrompt,
    context: CallContext,
  ): Promise<GatewayResult<CompletionOutcome>>;
  stream(
    spec: ModelCallSpec,
    prompt: GatewayPrompt,
    context: CallContext,
  ): Promise<GatewayResult<StreamOutcome>>;
}

export interface GatewayDeps {
  readonly registry: ModelRegistry;
  readonly transport: ModelTransport;
  readonly ledger: UsageLedger;
  readonly budgets: BudgetSource;
  readonly fx: FxRateService;
  readonly pricing?: PricingStore;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

/** How far the output ceiling is cut when a budget scope reaches its degrade mark. */
const DEGRADED_OUTPUT_SHARE = 0.5;

interface Attempt {
  readonly modelId: string;
  readonly tier: Tier;
  readonly attemptNumber: number;
}

export function createModelGateway(deps: GatewayDeps): ModelGateway {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());

  const account = createAccountant(deps);

  /** A row for a call that never reached a provider. */
  function deniedRow(
    spec: ModelCallSpec,
    context: CallContext,
    status: LedgerStatus,
    scope: BudgetScope | null,
    errorCode: string,
  ): LedgerRow {
    const entry = deps.registry.forTier(spec.tier);

    return {
      requestId: context.requestId,
      traceId: context.traceId ?? null,
      spanId: context.spanId ?? null,
      userIdHash: context.userIdHash,
      threadId: context.threadId ?? null,
      messageId: context.messageId ?? null,
      task: spec.task,
      tier: spec.tier,
      promptName: context.prompt?.name ?? null,
      promptVersion: context.prompt?.version ?? null,
      promptFingerprint: context.prompt?.fingerprint ?? null,
      provider: entry.provider,
      modelId: entry.modelId,
      modelIdResolved: entry.modelId,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: null,
      cachedInputTokens: null,
      maxOutputTokens: spec.maxOutputTokens,
      truncated: false,
      escalated: false,
      degraded: false,
      budgetScopeHit: scope,
      attemptNumber: 1,
      latencyMs: null,
      firstTokenMs: null,
      status,
      errorCode,
      costUsd: 0,
      fxRateEurPerUsd: null,
      fxStale: true,
      costEur: 0,
    };
  }

  /**
   * Everything that has to happen before a provider is contacted: spec
   * validation, the input ceiling, the euro budgets, and the turn's own
   * accumulator. Returns the plan for dispatch, or the refusal.
   */
  async function admit(
    spec: ModelCallSpec,
    prompt: GatewayPrompt,
    context: CallContext,
  ): Promise<
    | {
        readonly ok: true;
        readonly spec: ModelCallSpec;
        readonly attempts: readonly Attempt[];
        readonly degraded: boolean;
        readonly scopeHit: BudgetScope | null;
      }
    | { readonly ok: false; readonly failure: GatewayFailure; readonly detail: string }
  > {
    const parsed = modelCallSpecSchema.safeParse(spec);
    if (!parsed.success) {
      // Nothing was dispatched and nothing cost money, so there is nothing to
      // account for. A malformed spec is a programming error, not a call.
      return {
        ok: false,
        failure: "invalid_spec",
        detail: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; "),
      };
    }

    const valid = parsed.data;

    const withinCeiling = preflight(valid, prompt.inputTokens);
    if (!withinCeiling.ok) {
      await account.write(
        deniedRow(valid, context, "ceiling_denied", null, "input_ceiling"),
      );
      logger.warn("ceiling.denied", {
        task: valid.task,
        requestId: context.requestId,
        inputTokens: prompt.inputTokens,
        maxInputTokens: valid.maxInputTokens,
      });
      return withinCeiling;
    }

    const projectedEur = await projectCost(valid, prompt);

    let snapshots: Awaited<ReturnType<BudgetSource["snapshot"]>> = null;
    try {
      snapshots = await deps.budgets.snapshot({
        userIdHash: context.userIdHash,
        now: now(),
      });
    } catch (error) {
      logger.error("budget.snapshot_failed", { errorCode: errorCodeFor(error) });
    }

    const decision: BudgetDecision = evaluateBudgets(snapshots, projectedEur);

    if (decision.state === "deny") {
      await account.write(
        deniedRow(valid, context, "budget_denied", decision.scope, "budget"),
      );
      // A learner who can trigger unbounded spend has found a financial
      // denial-of-service, so a denial is an audit event and not just a metric
      // (security-observability-guardrails.md S24).
      logger.warn("budget.denied", {
        audit: true,
        task: valid.task,
        scope: decision.scope,
        userIdHash: context.userIdHash,
        requestId: context.requestId,
        detail: decision.detail,
      });
      return { ok: false, failure: "budget_denied", detail: decision.detail };
    }

    if (context.turn && (context.turn.remainingEur() <= 0 || context.turn.wouldExceed(projectedEur))) {
      await account.write(
        deniedRow(valid, context, "budget_denied", "per_request", "turn_budget"),
      );
      logger.warn("budget.denied", {
        audit: true,
        task: valid.task,
        scope: "per_request",
        userIdHash: context.userIdHash,
        requestId: context.requestId,
      });
      return {
        ok: false,
        failure: "budget_denied",
        detail: "this turn has spent its per-request budget",
      };
    }

    if (decision.state === "warn") {
      logger.warn("budget.warning", {
        task: valid.task,
        scope: decision.scope,
        detail: decision.detail,
      });
    }

    const degraded = decision.state === "degrade";
    // Downward only, and only one step. Under budget pressure the cheaper
    // model with a shorter reply is the graceful answer; a silent upgrade
    // would be the opposite.
    const tier = degraded ? (downgradeTier(spec.tier) ?? spec.tier) : spec.tier;
    const effective = degraded
      ? withLoweredOutputCeiling(
          valid,
          Math.ceil(valid.maxOutputTokens * DEGRADED_OUTPUT_SHARE),
        )
      : valid;

    if (degraded) {
      // Visible, because a quality regression nobody can attribute to a budget
      // is a quality regression nobody can explain.
      logger.warn("budget.degraded", {
        task: valid.task,
        scope: decision.scope,
        fromTier: valid.tier,
        toTier: tier,
        maxOutputTokens: effective.maxOutputTokens,
        detail: decision.detail,
      });
    }

    const attempts = deps.registry
      .candidates(tier)
      .map((modelId, index) => ({ modelId, tier, attemptNumber: index + 1 }));

    return {
      ok: true,
      spec: effective,
      attempts,
      degraded,
      scopeHit: decision.state === "allow" ? null : decision.scope,
    };
  }

  /**
   * A pre-flight euro estimate so the gate counts the call it is gating.
   * Zero when nothing can price it: an unpriceable call is not a free one, and
   * it is accounted for exactly once it has actually run.
   */
  async function projectCost(spec: ModelCallSpec, prompt: GatewayPrompt): Promise<number> {
    if (!deps.pricing) return 0;

    const entry = deps.registry.forTier(spec.tier);
    const rate = await resolveRate(deps.pricing, entry.provider, entry.modelId);
    const usd = estimateUsd(rate, {
      inputTokens: prompt.inputTokens,
      outputTokens: spec.maxOutputTokens,
    });

    if (usd === null) return 0;

    return applyFx(usd, await deps.fx.resolve(now())).costEur;
  }

  function requestFor(
    spec: ModelCallSpec,
    prompt: GatewayPrompt,
    modelId: string,
    signal: AbortSignal,
  ): ModelRequest {
    return {
      modelId,
      system: prompt.system,
      // Only a conversation recurs inside a provider cache's lifetime: the
      // same stable prefix returns turn after turn. A one-shot task would pay
      // the cache-write surcharge for an entry nothing reads back, so its
      // prefix is never marked.
      systemStablePrefix:
        CONVERSATION_TASKS.has(spec.task) && prompt.systemStable
          ? prompt.systemStable
          : null,
      user: prompt.user,
      // Layer 2. Always sent, never omitted.
      maxOutputTokens: spec.maxOutputTokens,
      signal,
      structured: spec.outputSchema !== undefined,
      // From the routing table, never from the caller. A search is billed per
      // result, so the same reasoning that stops a caller choosing its own
      // tier stops it switching this on.
      webSearch: webSearchFor(spec.task),
      // The tier's, so a schema-bound extractor on a reasoning model answers
      // instead of thinking its whole ceiling away.
      reasoningEffort: deps.registry.forTier(spec.tier).reasoningEffort ?? null,
    };
  }

  function withTimeout(timeoutMs: number) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    return { abort, done: () => clearTimeout(timer) };
  }

  function failureFor(error: unknown, abort: AbortController): GatewayFailure {
    return abort.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
      ? "timeout"
      : "provider_error";
  }

  async function recordAttempt(
    spec: ModelCallSpec,
    context: CallContext,
    attempt: Attempt,
    plan: { readonly degraded: boolean; readonly scopeHit: BudgetScope | null },
    outcome: {
      readonly status: LedgerStatus;
      readonly usage: ProviderUsage | null;
      readonly truncated: boolean;
      readonly latencyMs: number;
      readonly firstTokenMs: number | null;
      readonly errorCode: string | null;
    },
  ): Promise<{ id: number | null; costUsd: number; costEur: number }> {
    const entry = deps.registry.forTier(attempt.tier);
    // The provider's own figure first: it is what was actually charged for the
    // generation that ran, including whatever the router substituted.
    const priced = outcome.usage
      ? await account.price(
          outcome.usage.costUsd,
          entry.provider,
          attempt.modelId,
          outcome.usage,
        )
      : { costUsd: 0, fxRateEurPerUsd: null, fxStale: true, costEur: 0 };

    const id = await account.write({
      requestId: context.requestId,
      traceId: context.traceId ?? null,
      spanId: context.spanId ?? null,
      userIdHash: context.userIdHash,
      threadId: context.threadId ?? null,
      messageId: context.messageId ?? null,
      task: spec.task,
      tier: attempt.tier,
      promptName: context.prompt?.name ?? null,
      promptVersion: context.prompt?.version ?? null,
      promptFingerprint: context.prompt?.fingerprint ?? null,
      provider: entry.provider,
      modelId: attempt.modelId,
      modelIdResolved: outcome.usage?.modelIdResolved ?? attempt.modelId,
      inputTokens: outcome.usage?.inputTokens ?? 0,
      outputTokens: outcome.usage?.outputTokens ?? 0,
      reasoningTokens: outcome.usage?.reasoningTokens ?? null,
      cachedInputTokens: outcome.usage?.cachedInputTokens ?? null,
      maxOutputTokens: spec.maxOutputTokens,
      truncated: outcome.truncated,
      escalated: false,
      degraded: plan.degraded,
      budgetScopeHit: plan.scopeHit,
      attemptNumber: attempt.attemptNumber,
      latencyMs: outcome.latencyMs,
      firstTokenMs: outcome.firstTokenMs,
      status: outcome.status,
      errorCode: outcome.errorCode,
      ...priced,
    });

    context.turn?.record(priced.costEur);

    return { id, costUsd: priced.costUsd, costEur: priced.costEur };
  }

  return {
    async complete(spec, prompt, context) {
      const admitted = await admit(spec, prompt, context);
      if (!admitted.ok) return gatewayFail(admitted.failure, admitted.detail);

      let lastFailure: GatewayFailure = "provider_error";
      let lastDetail = "no provider attempt was made";

      for (const attempt of admitted.attempts) {
        const { abort, done } = withTimeout(admitted.spec.timeoutMs);
        const started = Date.now();

        try {
          const response: CompletionResponse = await deps.transport.complete(
            requestFor(admitted.spec, prompt, attempt.modelId, abort.signal),
          );

          const truncated = response.truncated ?? false;

          const recorded = await recordAttempt(admitted.spec, context, attempt, admitted, {
            status: "ok",
            usage: response.usage,
            truncated,
            latencyMs: Date.now() - started,
            firstTokenMs: response.firstTokenMs,
            errorCode: null,
          });

          return gatewayOk<CompletionOutcome>({
            text: response.text,
            truncated,
            degraded: admitted.degraded,
            tier: attempt.tier,
            modelIdResolved: response.usage.modelIdResolved,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            costUsd: recorded.costUsd,
            costEur: recorded.costEur,
            attempts: attempt.attemptNumber,
            ledgerId: recorded.id,
            citations: response.citations ?? [],
          });
        } catch (error) {
          lastFailure = failureFor(error, abort);
          lastDetail = errorCodeFor(error);

          await recordAttempt(admitted.spec, context, attempt, admitted, {
            status: statusForFailure(lastFailure) ?? "error",
            // A failed call may still have been billed. Nothing here reports
            // usage, so it is recorded as unpriced rather than as free.
            usage: null,
            truncated: false,
            latencyMs: Date.now() - started,
            firstTokenMs: null,
            errorCode: lastDetail,
          });

          logger.warn("provider.attempt_failed", {
            task: admitted.spec.task,
            tier: attempt.tier,
            attemptNumber: attempt.attemptNumber,
            errorCode: lastDetail,
          });
        } finally {
          done();
        }
      }

      return gatewayFail(lastFailure, lastDetail);
    },

    async stream(spec, prompt, context) {
      const admitted = await admit(spec, prompt, context);
      if (!admitted.ok) return gatewayFail(admitted.failure, admitted.detail);

      const plan = admitted;

      /*
       * The same ladder `complete` walks, and for the same reason: a tier's
       * primary being unavailable — retired, rate-limited, or refused by the
       * account's own data policy — is exactly what its fallback is for. This
       * path did not walk it, so one unreachable model took down every
       * conversation in the product while the non-streaming path recovered.
       *
       * It walks the ladder only up to the moment the stream opens. After
       * that, bytes have reached the learner and a second model would be
       * continuing somebody else's sentence, so a mid-stream failure stays
       * failed. Each attempt gets its own timeout window, or a slow first one
       * would spend the second one's.
       */
      let chosenAttempt: (typeof plan.attempts)[number] | null = null;
      let chosenStream: StreamResponse | null = null;
      let chosenAbort: AbortController | null = null;
      let chosenDone: (() => void) | null = null;
      let chosenStarted = 0;
      let lastFailure: GatewayFailure = "provider_error";
      let lastDetail = "no attempt was made";

      for (const candidate of plan.attempts) {
        const { abort, done } = withTimeout(plan.spec.timeoutMs);
        const startedAt = Date.now();

        try {
          const response = await deps.transport.stream(
            requestFor(plan.spec, prompt, candidate.modelId, abort.signal),
          );
          chosenAttempt = candidate;
          chosenStream = response;
          chosenAbort = abort;
          chosenDone = done;
          chosenStarted = startedAt;
          break;
        } catch (error) {
          done();
          lastFailure = failureFor(error, abort);
          lastDetail = errorCodeFor(error);

          await recordAttempt(plan.spec, context, candidate, plan, {
            status: statusForFailure(lastFailure) ?? "error",
            usage: null,
            truncated: false,
            latencyMs: Date.now() - startedAt,
            firstTokenMs: null,
            errorCode: lastDetail,
          });

          logger.warn("provider.attempt_failed", {
            task: plan.spec.task,
            tier: candidate.tier,
            attemptNumber: candidate.attemptNumber,
            errorCode: lastDetail,
          });
        }
      }

      if (!chosenAttempt || !chosenStream || !chosenAbort || !chosenDone) {
        return gatewayFail(lastFailure, lastDetail);
      }

      // Captured after narrowing: the generator and the finaliser below are
      // hoisted function declarations, and TypeScript will not carry a
      // narrowing into one.
      const attempt = chosenAttempt;
      const opened = chosenStream;
      const abort = chosenAbort;
      const done = chosenDone;
      const started = chosenStarted;

      const guard = guardStream(opened.chunks, {
        maxOutputTokens: plan.spec.maxOutputTokens,
        abort,
      });

      let settle: (outcome: CompletionOutcome) => void = () => {};
      const settled = new Promise<CompletionOutcome>((resolve) => {
        settle = resolve;
      });

      async function* observed(): AsyncGenerator<string, void, undefined> {
        try {
          for await (const chunk of guard.stream) yield chunk;
        } finally {
          done();
          settle(await finish(guard.result()));
        }
      }

      async function finish(result: StreamGuardResult): Promise<CompletionOutcome> {
        const reported = opened.usage();
        // The guard's own count is what the learner received. Where the
        // provider disagrees because the stream was cut, the guard is right.
        const usage: ProviderUsage = {
          inputTokens: reported?.inputTokens ?? prompt.inputTokens,
          outputTokens: result.truncated
            ? result.outputTokens
            : (reported?.outputTokens ?? result.outputTokens),
          reasoningTokens: reported?.reasoningTokens ?? null,
          cachedInputTokens: reported?.cachedInputTokens ?? null,
          costUsd: reported?.costUsd ?? null,
          modelIdResolved: reported?.modelIdResolved ?? attempt.modelId,
        };

        const recorded = await recordAttempt(plan.spec, context, attempt, plan, {
          status: "ok",
          usage,
          truncated: result.truncated,
          latencyMs: Date.now() - started,
          firstTokenMs: opened.firstTokenMs(),
          errorCode: null,
        });

        return {
          text: result.text,
          truncated: result.truncated,
          degraded: plan.degraded,
          tier: attempt.tier,
          modelIdResolved: usage.modelIdResolved,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: recorded.costUsd,
          costEur: recorded.costEur,
          attempts: attempt.attemptNumber,
          ledgerId: recorded.id,
          // Always empty: a streaming task is a conversation task, and no
          // conversation task is granted a web search. A test locks that, so
          // this is a consequence of the routing table rather than an omission
          // waiting to be noticed.
          citations: [],
        };
      }

      return gatewayOk<StreamOutcome>({
        chunks: observed(),
        settled,
        tier: attempt.tier,
        degraded: plan.degraded,
      });
    },
  };
}
