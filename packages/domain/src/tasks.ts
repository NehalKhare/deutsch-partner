import { z } from "zod";

import type { CEFRLevel } from "./cefr";
import type { PlanCode } from "./plans";

/**
 * The normative task table.
 *
 * Transcribed from model-routing-and-cost-control.md sections 3, 4 and 6. Code
 * refers to tiers, never to model names: the tier-to-model mapping is the
 * gateway's registry and does not belong here. What does belong here is the
 * pairing of a task with the tier it is allowed to run on and the ceilings it
 * is allowed to spend, because both the prompt catalogue and the router have to
 * agree on them and neither should own the other's copy.
 *
 * A task absent from this table does not get to call a model.
 */

export const TIERS = [
  "reasoning",
  "strong",
  "mid",
  "cheap",
  "nano",
  "embedding",
  "stt",
  "tts",
] as const;

export const tierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof tierSchema>;

/**
 * The tiers that carry chat, strongest first.
 *
 * The one ladder both directions of travel are measured on: budget
 * degradation steps one rung down it, and a plan entry may only sit at or
 * below its task's own rung. The gateway's registry walks this same constant,
 * so "down" cannot mean one thing to the router and another to the degrader.
 */
export const CHAT_TIER_LADDER = [
  "reasoning",
  "strong",
  "mid",
  "cheap",
  "nano",
] as const satisfies readonly Tier[];

export type ChatTier = (typeof CHAT_TIER_LADDER)[number];

export const TASK_IDS = [
  "conversation.turn",
  "conversation.repair",
  "evaluation.learner_message",
  "assessment.milestone",
  "assessment.mini_level_check",
  "assessment.onboarding",
  "extraction.errors",
  "extraction.memory",
  "extraction.vocabulary_usage",
  "summarization.thread",
  "classification.intent",
  "classification.topic",
  "classification.language",
  "classification.safety_screen",
  "recommendation.tiebreak",
  "retrieval.query_rewrite",
  "ingestion.metadata_tagging",
  "ingestion.embedding",
  "retrieval.embedding",
  "trainer.session",
  "trainer.answer_analysis",
  "trainer.session_mining",
  "productops.market_research",
  "productops.proposal_synthesis",
  "productops.prd_sections",
  "productops.code_plan",
  "productops.plan_breakdown",
  "productops.code_edit",
  "productops.context_summary",
] as const;

export const taskIdSchema = z.enum(TASK_IDS);
export type TaskId = z.infer<typeof taskIdSchema>;

export interface TokenCeilings {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

/**
 * Grounding a call in a web search.
 *
 * A property of the task rather than of the call spec, deliberately. Search
 * results are billed per result, so a caller that could switch this on would
 * be a caller that could spend money the routing table never budgeted for —
 * the same reasoning that keeps a caller from choosing its own tier. Only the
 * tasks named here may search, and none of them chooses how much.
 */
export interface WebSearch {
  readonly maxResults: number;
}

/**
 * What a plan changes about a task (billing-and-plans-spec.md S3).
 *
 * A tier at or below the row's on the chat ladder, and ceilings at or below
 * the row's; both are asserted by tests over the whole table. The plan itself
 * is resolved on the server from entitlement rows, so this is still a lookup
 * and still nothing a caller chooses.
 */
export interface PlanRoute {
  readonly tier?: Tier;
  readonly byLevel?: Readonly<Record<CEFRLevel, TokenCeilings>>;
}

/**
 * How much a reasoning-capable model may think before it answers, in the
 * provider's own vocabulary. A tier carries a default in the gateway's
 * registry; a task may bound it further here, never loosen it.
 */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface TaskRoute extends TokenCeilings {
  readonly tier: Tier;
  /**
   * A ceiling on thinking for this task, over the tier's own default.
   *
   * The output ceiling is what the provider counts, and a reasoning model
   * counts its thinking inside it. The tutor answers an A1 learner inside
   * 300 tokens; left to decide, the strong tier's model spent nearly all of
   * them thinking about a roleplay and the learner saw "Guten Tag," — three
   * tokens and a cut. A conversation turn is three to eight sentences of
   * German from a model that needs no scratchpad to write them.
   */
  readonly reasoningEffort?: ReasoningEffort;
  /**
   * conversation.turn is pitched differently at each level, so its ceilings
   * are too. Everything else uses one pair.
   */
  readonly byLevel?: Readonly<Record<CEFRLevel, TokenCeilings>>;
  /**
   * Only the tutor, its repair and the Trainer's loop carry one. Adding an
   * entry anywhere else is an edit to the billing spec first: see
   * PLAN_INVARIANT_TASKS for the tasks that must never have one.
   */
  readonly byPlan?: Readonly<Partial<Record<PlanCode, PlanRoute>>>;
  readonly webSearch?: WebSearch;
}

const ROUTES: Readonly<Record<TaskId, TaskRoute>> = {
  /**
   * The tutor. The row is the most any plan may reach, which is premium's B1
   * and exactly the strong tier's hard maxima; it is what a spec is validated
   * against, not what a call is given. The level table beneath it is what
   * every plan without its own gets — the ceilings the tutor had before plans
   * existed, so a call that names no plan resolves exactly as it did.
   *
   * Free moves down to mid and keeps the level table, which fits mid's
   * maxima. Premium keeps strong and widens every level: room for more of the
   * conversation and the knowledge it retrieves, and a longer reply at B1,
   * where the answers a learner can follow are longer too.
   */
  "conversation.turn": {
    tier: "strong",
    reasoningEffort: "minimal",
    maxInputTokens: 8000,
    maxOutputTokens: 1000,
    byLevel: {
      A1: { maxInputTokens: 4000, maxOutputTokens: 300 },
      A2: { maxInputTokens: 5000, maxOutputTokens: 450 },
      B1: { maxInputTokens: 6000, maxOutputTokens: 700 },
    },
    byPlan: {
      free: { tier: "mid" },
      premium: {
        byLevel: {
          A1: { maxInputTokens: 5000, maxOutputTokens: 400 },
          A2: { maxInputTokens: 6500, maxOutputTokens: 600 },
          B1: { maxInputTokens: 8000, maxOutputTokens: 1000 },
        },
      },
    },
  },
  /** The same voice as the turn it repairs, so the same plan entry. */
  "conversation.repair": {
    tier: "strong",
    reasoningEffort: "minimal",
    maxInputTokens: 6000,
    maxOutputTokens: 700,
    byPlan: { free: { tier: "mid" } },
  },
  "evaluation.learner_message": { tier: "mid", maxInputTokens: 3000, maxOutputTokens: 800 },
  "assessment.milestone": { tier: "reasoning", maxInputTokens: 8000, maxOutputTokens: 1500 },
  "assessment.mini_level_check": { tier: "mid", maxInputTokens: 3000, maxOutputTokens: 600 },
  "assessment.onboarding": { tier: "mid", maxInputTokens: 3000, maxOutputTokens: 800 },
  "extraction.errors": { tier: "cheap", maxInputTokens: 2000, maxOutputTokens: 400 },
  "extraction.memory": { tier: "cheap", maxInputTokens: 3000, maxOutputTokens: 300 },
  "extraction.vocabulary_usage": { tier: "cheap", maxInputTokens: 1500, maxOutputTokens: 300 },
  "summarization.thread": { tier: "cheap", maxInputTokens: 6000, maxOutputTokens: 400 },
  "classification.intent": { tier: "nano", maxInputTokens: 800, maxOutputTokens: 20 },
  "classification.topic": { tier: "nano", maxInputTokens: 800, maxOutputTokens: 20 },
  "classification.language": { tier: "nano", maxInputTokens: 400, maxOutputTokens: 10 },
  "classification.safety_screen": { tier: "nano", maxInputTokens: 1000, maxOutputTokens: 10 },
  "recommendation.tiebreak": { tier: "cheap", maxInputTokens: 1500, maxOutputTokens: 150 },
  "retrieval.query_rewrite": { tier: "cheap", maxInputTokens: 600, maxOutputTokens: 120 },
  "ingestion.metadata_tagging": { tier: "cheap", maxInputTokens: 4000, maxOutputTokens: 400 },
  /**
   * Embeddings produce a vector, not tokens, so the output ceiling is zero
   * rather than small. The input ceiling is the model's own context window:
   * section 6 of the routing document does not set one for these two, because
   * a chunk longer than the model can read is a chunking bug rather than a
   * budget decision.
   */
  "ingestion.embedding": { tier: "embedding", maxInputTokens: 8191, maxOutputTokens: 0 },
  "retrieval.embedding": { tier: "embedding", maxInputTokens: 8191, maxOutputTokens: 0 },
  /**
   * The Trainer's agent loop, on the same tier as the tutor it trains for.
   *
   * The best tier this loop can actually afford, which is not the same as the
   * best tier. One request is up to seven model invocations under a €0.05
   * per-request ceiling, so the price of a call is multiplied by seven before
   * it is compared to that bound. Measured on one correction with this prompt:
   * the reasoning tier ran about $0.014 a call, which three or four
   * invocations into a session exhausts the turn budget — and a Trainer turn
   * that dies halfway is the worst failure this feature has. The strong tier
   * ran about $0.005, leaving the full seven-step loop inside the ceiling.
   *
   * It is a real upgrade over the mid tier it moved from, and not only in
   * judgement: the mid model spent 590 to 706 tokens thinking before writing
   * a correction, where this one spends none.
   *
   * The output ceiling is the tier's full allowance rather than the 700 the
   * other conversational tasks get, because a reasoning model spends this
   * budget before it writes anything. A live correction — the rule, the
   * corrected sentence, two model sentences and a word to use instead — came
   * back cut off mid-word at 700, two thirds of it spent thinking. Nothing is
   * billed for room it does not use; a ceiling is a limit, not a purchase.
   *
   * Free runs it on mid, the tier it moved up from, under free's smaller
   * per-request bound (plans.ts). The ceilings stay the row's: mid's maxima
   * hold them, and mid is the model that did its thinking out of this budget.
   */
  "trainer.session": {
    tier: "strong",
    maxInputTokens: 6000,
    maxOutputTokens: 1000,
    byPlan: { free: { tier: "mid" } },
  },
  /**
   * The Trainer's answer analyzer: one structured pass over one learner
   * sentence, in the reply path before the loop's first call. Cheap because
   * the schema is small and closed — the same tier extraction.errors runs
   * against the identical taxonomy — and because it spends from the same
   * €0.05 request ceiling as the loop it precedes: a dearer tier here is
   * subtracted from the coach itself.
   */
  "trainer.answer_analysis": { tier: "cheap", maxInputTokens: 2000, maxOutputTokens: 500 },
  /**
   * The post-session miner: one pass over the finished session's transcript
   * tail, after the response has gone out. Nobody is waiting, but it runs on
   * every completed session, so it stays on the cheap tier with a repair pass
   * rather than buying mid-tier accuracy for aggregate counters.
   */
  "trainer.session_mining": { tier: "cheap", maxInputTokens: 4000, maxOutputTokens: 600 },
  /**
   * Market research: extraction from web results against a closed schema.
   *
   * On the cheap tier because that is what this is — pulling structured
   * findings out of text somebody else wrote — and not the judgement that
   * comes after it. The tier is also the one with the largest input allowance
   * in the registry, 8000, which is exactly what a page of search results
   * needs; the mid tier would cost more and read less. Output is small on
   * purpose: at most two findings per call, so a scan is many cheap calls with
   * their own ledger rows and their own idempotency key rather than one long
   * call that is all-or-nothing.
   *
   * The promotion path is the documented one. If the golden set shows this
   * tier failing schema validation often enough that repairs cost more than
   * mid-tier calls would, it moves up with that measurement attached.
   */
  "productops.market_research": {
    tier: "cheap",
    maxInputTokens: 8000,
    maxOutputTokens: 600,
    webSearch: { maxResults: 5 },
  },
  /**
   * The product judgement this whole feature exists to produce. Rare, offline,
   * and the thing a human reviews — the same profile as assessment.milestone,
   * which is the other task on this tier.
   */
  "productops.proposal_synthesis": {
    tier: "reasoning",
    maxInputTokens: 12_000,
    maxOutputTokens: 2000,
  },
  /**
   * Only the sections of a PRD that need judgement. The document around them
   * is rendered from the approved proposal's own columns, so this asks for
   * user stories and acceptance criteria rather than for a restatement of what
   * is already stored.
   *
   * Mid rather than strong: this is structured output derived from a proposal
   * a person has already approved, which is what the mid tier is described
   * for. Reaching up to strong would be reaching without evidence, and the
   * strong tier is also the streaming hot path, which this is not.
   */
  "productops.prd_sections": {
    tier: "mid",
    maxInputTokens: 6000,
    maxOutputTokens: 1000,
  },
  /**
   * Reading the repository and deciding what a change touches. The hardest
   * reasoning in the product, off every hot path, and the output a person
   * approves before anything is written.
   */
  "productops.code_plan": {
    tier: "reasoning",
    maxInputTokens: 12_000,
    maxOutputTokens: 2000,
  },
  /**
   * The engineering manager's half of the plan: the PRD broken into phased,
   * sized requirements, with technical guidance against the current stack.
   * The same judgement as the plan and the same profile — rare, offline, a
   * person reads it — so the same tier. A second call rather than a bigger
   * one, because the plan's file lists and this do not fit one 2000-token
   * answer together.
   */
  "productops.plan_breakdown": {
    tier: "reasoning",
    maxInputTokens: 12_000,
    maxOutputTokens: 2000,
  },
  /**
   * One file's worth of anchored edits.
   *
   * 2000 output tokens is the reasoning tier's hardMaxOutputTokens and
   * therefore the most any call in this application may emit. A source file
   * does not fit in it, which is why domain/product-ops.ts models an edit as
   * an anchor and a replacement and will not accept whole contents for a file
   * that already exists. The ceiling came first; the shape followed.
   */
  "productops.code_edit": {
    tier: "reasoning",
    maxInputTokens: 12_000,
    maxOutputTokens: 2000,
  },
  /**
   * Folding an agent's older tool results into a summary when its transcript
   * nears the task's input ceiling. Compression, not judgement: the cheap
   * tier, with the same input allowance the research task has, because what
   * it reads is exactly the fenced tool output the agent read.
   */
  "productops.context_summary": {
    tier: "cheap",
    maxInputTokens: 8000,
    maxOutputTokens: 400,
  },
};

export function routeFor(task: TaskId): TaskRoute {
  return ROUTES[task];
}

/** The product-ops workflow's own tasks, named so tests can sweep them. */
export const PRODUCT_OPS_TASKS = TASK_IDS.filter((task) =>
  task.startsWith("productops."),
);

/**
 * Every task allowed to reach the web, derived from the table rather than
 * listed twice. A task acquires this by having a webSearch route, which is a
 * deliberate edit here, not a flag a call site can pass.
 */
export const WEB_SEARCH_TASKS: readonly TaskId[] = TASK_IDS.filter(
  (task) => ROUTES[task].webSearch !== undefined,
);

/** The search a task is permitted, or null for the great majority that is none. */
export function webSearchFor(task: TaskId): WebSearch | null {
  return ROUTES[task].webSearch ?? null;
}

/**
 * A plan's entry for a task, if it has one. An own property only: the plan
 * reaching here has been validated, but a lookup that could return
 * Object.prototype for "__proto__" is not one to leave to that.
 */
function planRouteFor(route: TaskRoute, plan: PlanCode | undefined): PlanRoute | undefined {
  if (plan === undefined || route.byPlan === undefined) return undefined;
  return Object.hasOwn(route.byPlan, plan) ? route.byPlan[plan] : undefined;
}

/** The tier a task runs on, for a plan where the plan changes it. */
export function tierFor(task: TaskId, plan?: PlanCode): Tier {
  const route = ROUTES[task];
  return planRouteFor(route, plan)?.tier ?? route.tier;
}

function largestOf(table: Readonly<Record<CEFRLevel, TokenCeilings>>): TokenCeilings {
  const levels = Object.values(table);
  return {
    maxInputTokens: Math.max(...levels.map((ceilings) => ceilings.maxInputTokens)),
    maxOutputTokens: Math.max(...levels.map((ceilings) => ceilings.maxOutputTokens)),
  };
}

/**
 * The ceilings a task runs under, narrowed by plan and level where it varies.
 *
 * The plan's own level table if it has one, else the task's, else the row.
 * With no level, the largest the applicable table reaches at any level — not
 * the row, which is the maximum across plans: a free call that forgot its
 * level must not be handed premium's context, and a call with neither plan
 * nor level must resolve as it did before plans existed.
 */
/** The task's bound on thinking, or null to leave it to the tier. */
export function reasoningEffortFor(task: TaskId): ReasoningEffort | null {
  return ROUTES[task].reasoningEffort ?? null;
}

export function ceilingsFor(task: TaskId, level?: CEFRLevel, plan?: PlanCode): TokenCeilings {
  const route = ROUTES[task];
  const table = planRouteFor(route, plan)?.byLevel ?? route.byLevel;

  if (!table) return maxCeilingsFor(task);
  return (level ? table[level] : undefined) ?? largestOf(table);
}

/**
 * The row: the most any call of this task may carry, on any plan at any
 * level. What a call spec is validated against and what a tier's hard maxima
 * must hold.
 */
export function maxCeilingsFor(task: TaskId): TokenCeilings {
  const route = ROUTES[task];
  return { maxInputTokens: route.maxInputTokens, maxOutputTokens: route.maxOutputTokens };
}

/** The tasks a plan changes, derived from the table rather than listed twice. */
export const PLAN_ROUTED_TASKS: readonly TaskId[] = TASK_IDS.filter(
  (task) => ROUTES[task].byPlan !== undefined,
);

/**
 * The tasks that are identical on every plan (billing-and-plans-spec.md S4).
 *
 * They write learner state or grade German, and a level has to mean the same
 * thing whoever is paying: a cheaper evaluator for free learners would make
 * an A2 on Free a smaller A2. Safety is here because safety is not a feature.
 * A test holds every one of them without a byPlan entry.
 */
export const PLAN_INVARIANT_TASKS: readonly TaskId[] = [
  "evaluation.learner_message",
  "extraction.errors",
  "extraction.vocabulary_usage",
  "trainer.answer_analysis",
  "trainer.session_mining",
  "classification.safety_screen",
  ...TASK_IDS.filter((task) => task.startsWith("assessment.")),
];

/**
 * Work the routing table names as explicitly not a model call. Listed so a
 * test can assert none of them ever acquires a route.
 */
export const DETERMINISTIC_ONLY = [
  "mini_level_progression",
  "mastery_score_calculation",
  "review_scheduling",
  "level_advancement_gating",
  "difficulty_band_selection",
  "behavior_policy_selection",
  "recommendation.ranking",
] as const;
