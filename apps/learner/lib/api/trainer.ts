import { z } from "zod";

import {
  HISTORY_WINDOW,
  MAX_MESSAGE_LENGTH,
  transcriptMessageSchema,
} from "@dp/domain/conversation";
import { nonEmptyTextSchema } from "@dp/domain/primitives";
import {
  coveredSubjectsSchema,
  pinnedAgendaSchema,
} from "@dp/domain/trainer-session";
import { createTurnBudget } from "@dp/gateway/budgeter";
import { evaluateBudgets, type BudgetSource } from "@dp/gateway/budget-gate";
import type { ModelGateway } from "@dp/gateway/gateway";
import type {
  TrainerModel,
  TrainerModelContext,
} from "@dp/gateway/langchain-model";
import { fingerprint } from "@dp/prompts/fingerprint";
import {
  TRAINER_PROMPT_NAME,
  TRAINER_PROMPT_VERSION,
  trainerSystemPrompt,
} from "@dp/prompts/trainer";
import type { AnswerAnalysis } from "@dp/domain/trainer-analysis";
import {
  defaultCoachingProfile,
  dialsOf,
  shouldVerifyBeforeCorrecting,
  type CoachingDials,
  type TrainerCoachingProfile,
} from "@dp/domain/trainer-coaching";
import { trainerCoachingBlock, trainerPersonalityBlock } from "@dp/prompts/trainer";
import type { TrainerPersonality } from "@dp/domain/learner";
import type { TrainerAgendaItem } from "@/lib/trainer/agenda";
import { runTrainerTurn } from "@/lib/trainer/agent";
import {
  createAnswerAnalyzer,
  renderAnalysisBlock,
} from "@/lib/trainer/analysis";
import { shouldAnalyze } from "@/lib/trainer/analysis-gate";
import type { McpToolset } from "@/lib/trainer/mcp";
import { foldFindings, mineSession } from "@/lib/trainer/miner";
import { createTrainerTools, type TrainerSource } from "@/lib/trainer/tools";
import type { GermanLearningRetriever } from "@/lib/retrieval/retriever";
import { nullLogger, type Logger } from "@dp/observability/logger";
import type { GrammarRepository } from "@dp/db/grammar-repository";
import type { LearnerErrorRepository } from "@dp/db/learner-error-repository";
import type { LearnerRepository } from "@dp/db/learner-repository";
import type { MinedSessionRepository } from "@dp/db/mined-session-repository";
import type { PerformanceRepository } from "@dp/db/performance-repository";
import type { TrainerCoachingRepository } from "@dp/db/trainer-coaching-repository";
import type { VocabularyRepository } from "@dp/db/vocabulary-repository";

/**
 * The trainer endpoint's logic, with the framework left outside.
 *
 * Same shape as lib/api/chat.ts, same reasons: a pure function of a parsed
 * body and injected dependencies, so the route handler stays thin and this is
 * what the tests drive. The order is the guardrails' (S5): validate, check
 * the budget, do the work, say only closed things about failures.
 *
 * The budget check is up front and fail-closed. One trainer request is up to
 * seven model calls, so a learner over their euro limit is refused before the
 * first one rather than after the sixth — and unreadable counters are a
 * refusal too, because "unknown" is not a spending limit.
 */

export const trainerRequestSchema = z.strictObject({
  message: nonEmptyTextSchema(MAX_MESSAGE_LENGTH),
  // The transcript lives in the learner's browser, exactly like the chat's.
  history: z.array(transcriptMessageSchema).max(HISTORY_WINDOW).default([]),
  // And so does the session's progress: the subjects already worked through,
  // sent back so the agenda never offers the same item twice.
  covered: coveredSubjectsSchema,
  // The agenda the session opened with, pinned: later turns serve what is
  // left of that promise instead of recomposing from the whole backlog.
  agenda: pinnedAgendaSchema.optional(),
});

export type TrainerRequest = z.infer<typeof trainerRequestSchema>;

export const TRAINER_ERRORS = [
  "unauthenticated",
  "invalid_body",
  "rate_limited",
  "budget_denied",
  "generation_failed",
] as const;

export type TrainerError = (typeof TRAINER_ERRORS)[number];

const RESPONSES: Readonly<Record<TrainerError, { status: number; message: string }>> = {
  unauthenticated: { status: 401, message: "Please sign in to keep practising." },
  invalid_body: { status: 400, message: "That message could not be sent." },
  rate_limited: {
    status: 429,
    message: "You are practising very quickly. Give it a moment.",
  },
  budget_denied: {
    status: 429,
    message: "Today's practice budget is used up. Come back a little later.",
  },
  generation_failed: {
    status: 503,
    message: "Your trainer is unavailable right now. Please try again shortly.",
  },
};

export const trainerErrorResponse = (error: TrainerError) => RESPONSES[error];

/** The per-request euro ceiling for the whole loop. A bound, not a price. */
export const TRAINER_MAX_TURN_EUR = 0.05;

/** The post-session miner's own ceiling: the request's budget is already spent. */
export const TRAINER_MINER_MAX_EUR = 0.01;

/**
 * How many of the learner's own notes ride into the coaching block. Three:
 * the most recent requests are the ones that still stand, and each is a
 * fenced line the model reads on every invocation of every turn.
 */
export const COACHING_NOTES_IN_PROMPT = 3;

export interface TrainerDeps {
  readonly learners: LearnerRepository;
  readonly errors: LearnerErrorRepository;
  readonly vocabulary: VocabularyRepository;
  readonly performance: PerformanceRepository;
  readonly grammar: GrammarRepository;
  readonly retriever: GermanLearningRetriever;
  readonly budgets: BudgetSource;
  /** The two-role gateway, for the answer analyzer's structured call. */
  readonly gateway: ModelGateway;
  /** Builds the ledger-attached LangChain models — the tier's primary and
   * its same-tier fallbacks, in the order to try. Injected so tests script it. */
  readonly createModels: (context: TrainerModelContext) => readonly TrainerModel[];
  /** Connects to the configured remote MCP server, or returns no tools. */
  readonly loadMcp: (identity: {
    readonly requestId: string;
    readonly userIdHash: string;
  }) => Promise<McpToolset>;
  /** The post-session miner's idempotency guard. */
  readonly mined: MinedSessionRepository;
  /**
   * What the learner's feedback has taught the trainer, and where the
   * adjust_coaching tool writes. Optional so a composition without it runs
   * the trainer exactly as before: defaults, no block, no tool writes kept.
   */
  readonly coaching?: TrainerCoachingRepository;
  /**
   * Runs work after the response has gone out — the route hands in Next's
   * after(), tests hand in something synchronous. The learner never waits on
   * anything scheduled here.
   */
  readonly schedule: (work: () => Promise<void>) => void;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface TrainerTurnPayload {
  readonly reply: string;
  readonly steps: readonly { readonly tool: string; readonly summary: string }[];
  readonly sources: readonly TrainerSource[];
  /** What the session covers, or null when this turn did not plan one. */
  readonly agenda: readonly TrainerAgendaItem[] | null;
  /** What is done, for the client to hold and send back next turn. */
  readonly covered: readonly string[];
  /** The agenda was worked through: this session is over. */
  readonly complete: boolean;
  /**
   * How the trainer is coaching this learner after this turn — the dials, as
   * their feedback and this turn's adjust_coaching calls left them. Shown so
   * a learner can see what their feedback did.
   */
  readonly coaching: CoachingDials;
  readonly costEur: number;
}

/**
 * The learner's coaching profile and their recent notes, read for one turn.
 *
 * Every failure is a value: an unreadable profile is the default profile and
 * no notes, so the trainer runs as it did before there was feedback. A
 * learner whose coaching cannot be read still gets coached.
 */
async function readCoaching(
  repository: TrainerCoachingRepository | undefined,
  learnerId: string,
  at: Date,
): Promise<{ profile: TrainerCoachingProfile; notes: readonly string[] }> {
  const fallback = { profile: defaultCoachingProfile(learnerId, at), notes: [] };
  if (repository === undefined) return fallback;

  const [profile, notes] = await Promise.all([
    repository.getProfile(learnerId).catch(() => null),
    repository.listRecentNotes(learnerId, COACHING_NOTES_IN_PROMPT).catch(() => null),
  ]);

  return {
    profile:
      profile !== null && profile.ok && profile.data !== null
        ? profile.data
        : fallback.profile,
    notes: notes !== null && notes.ok ? notes.data : [],
  };
}

/**
 * The manner the learner chose, read for one turn.
 *
 * The same discipline as readCoaching: an unreadable profile is the trainer
 * as shipped, so a learner whose profile cannot be read still gets a trainer
 * — the friendly one, which is what they had before there was a choice.
 */
async function readPersonality(
  learners: LearnerRepository,
  learnerId: string,
): Promise<TrainerPersonality> {
  try {
    const profile = await learners.getProfile(learnerId);
    return profile.ok ? profile.data.trainerPersonality : "friendly";
  } catch {
    return "friendly";
  }
}

export type TrainerResult =
  | { readonly ok: true; readonly payload: TrainerTurnPayload }
  | { readonly ok: false; readonly error: TrainerError };

export async function handleTrainerTurn(
  body: unknown,
  identity: {
    readonly learnerId: string;
    readonly userIdHash: string;
    readonly requestId: string;
  },
  deps: TrainerDeps,
): Promise<TrainerResult> {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());

  const parsed = trainerRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "invalid_body" };

  // Fail closed before the first model call, not after the sixth.
  const snapshots = await deps.budgets
    .snapshot({ userIdHash: identity.userIdHash, now: now() })
    .catch(() => null);
  const decision = evaluateBudgets(snapshots);
  if (decision.state === "deny") {
    logger.warn("trainer.budget_denied", {
      audit: true,
      requestId: identity.requestId,
      userIdHash: identity.userIdHash,
      scope: decision.scope,
    });
    return { ok: false, error: "budget_denied" };
  }
  if (decision.state !== "allow") {
    logger.warn("trainer.budget_pressure", {
      requestId: identity.requestId,
      userIdHash: identity.userIdHash,
      state: decision.state,
      scope: decision.scope,
    });
  }

  const turn = createTurnBudget(TRAINER_MAX_TURN_EUR);
  const ladder = deps.createModels({
    requestId: identity.requestId,
    userIdHash: identity.userIdHash,
    turn,
    prompt: {
      name: TRAINER_PROMPT_NAME,
      version: TRAINER_PROMPT_VERSION,
      fingerprint: fingerprint(trainerSystemPrompt()),
    },
  });

  // What this learner's feedback has taught the trainer, and the manner they
  // chose: read once per turn, rendered once each into the system message,
  // and the coaching handed on to the tools that size and mix the agenda by it.
  const [coaching, personality] = await Promise.all([
    readCoaching(deps.coaching, identity.learnerId, now()),
    readPersonality(deps.learners, identity.learnerId),
  ]);
  const personalityBlock = trainerPersonalityBlock(personality);
  const coachingBlock =
    trainerCoachingBlock({
      dials: dialsOf(coaching.profile),
      verifyBeforeCorrecting: shouldVerifyBeforeCorrecting(coaching.profile),
      notes: coaching.notes,
    }) ?? undefined;

  const local = createTrainerTools({
    learnerId: identity.learnerId,
    covered: parsed.data.covered,
    pinned: parsed.data.agenda?.map((item) => item.subject),
    userIdHash: identity.userIdHash,
    requestId: identity.requestId,
    vocabulary: deps.vocabulary,
    errors: deps.errors,
    performance: deps.performance,
    learners: deps.learners,
    grammar: deps.grammar,
    retriever: deps.retriever,
    coaching:
      deps.coaching === undefined
        ? undefined
        : { profile: coaching.profile, repository: deps.coaching },
    logger,
    now,
  });
  const mcp = await deps.loadMcp({
    requestId: identity.requestId,
    userIdHash: identity.userIdHash,
  });

  // The answer analyzer: one structured pass over the learner's German before
  // the loop's first call, spending from the same per-request budget. Code
  // decides whether it runs — a deterministic gate, not a model's whim — and
  // every failure is a value: the trainer judges unaided, as it did before.
  let analysis: string | undefined;
  let findings: AnswerAnalysis | undefined;
  const gate = shouldAnalyze(parsed.data.message);
  if (gate.analyze) {
    const state = await deps.learners
      .getState(identity.learnerId)
      .catch(() => null);
    const analyzer = createAnswerAnalyzer({ gateway: deps.gateway, logger });
    const analyzed = await analyzer.analyze(
      {
        message: parsed.data.message,
        cefr: state !== null && state.ok ? state.data.effectiveLevel.cefr : "A1",
        precedingTurns: parsed.data.history.slice(-2),
      },
      {
        requestId: identity.requestId,
        userIdHash: identity.userIdHash,
        turn,
      },
    );
    if (analyzed.status === "analyzed") {
      analysis = renderAnalysisBlock(analyzed.analysis);
      findings = analyzed.analysis;
    }
  } else {
    logger.debug("trainer.analysis_skipped", {
      reason: gate.reason,
      requestId: identity.requestId,
    });
  }

  try {
    const outcome = await runTrainerTurn(
      {
        models: ladder,
        tools: [...local.tools, ...mcp.tools],
        personality: personalityBlock,
        coaching: coachingBlock,
        logger,
      },
      { message: parsed.data.message, history: parsed.data.history, analysis },
    );

    if (!outcome.ok) {
      return {
        ok: false,
        error: outcome.failure === "budget_exhausted" ? "budget_denied" : "generation_failed",
      };
    }

    logger.info("trainer.turn_completed", {
      requestId: identity.requestId,
      userIdHash: identity.userIdHash,
      steps: outcome.data.steps.length,
      covered: local.covered().length,
      complete: local.complete(),
      analysis: findings !== undefined,
      coached: coachingBlock !== undefined,
      personality,
      costEur: Number(turn.spentEur().toFixed(8)),
    });

    // After the response has gone out: the turn's validated findings become
    // recurring-mistake rows (no model call), and a completed session gets
    // one mining pass for what per-turn analysis cannot see. Neither is ever
    // something the learner waits on, and each degrades to nothing.
    if (findings !== undefined) {
      const analysed = findings;
      deps.schedule(() =>
        foldFindings(
          {
            errors: deps.errors,
            learnerId: identity.learnerId,
            requestId: identity.requestId,
            logger,
            now,
          },
          analysed,
        ),
      );
    }
    if (local.complete()) {
      const transcript = [
        ...parsed.data.history,
        { role: "user" as const, content: parsed.data.message },
        { role: "assistant" as const, content: outcome.data.reply },
      ];
      const covered = local.covered();
      deps.schedule(() =>
        mineSession(
          {
            gateway: deps.gateway,
            errors: deps.errors,
            vocabulary: deps.vocabulary,
            learners: deps.learners,
            mined: deps.mined,
            learnerId: identity.learnerId,
            requestId: identity.requestId,
            userIdHash: identity.userIdHash,
            budget: createTurnBudget(TRAINER_MINER_MAX_EUR),
            logger,
            now,
          },
          { transcript, covered },
        ),
      );
    }

    return {
      ok: true,
      payload: {
        reply: outcome.data.reply,
        steps: outcome.data.steps,
        sources: local.sources(),
        agenda: local.agenda(),
        covered: local.covered(),
        complete: local.complete(),
        coaching: dialsOf(local.coaching()),
        costEur: turn.spentEur(),
      },
    };
  } finally {
    await mcp.close();
  }
}
