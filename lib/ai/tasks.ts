import { z } from "zod";

import type { CEFRLevel } from "@/domain/cefr";

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
] as const;

export const taskIdSchema = z.enum(TASK_IDS);
export type TaskId = z.infer<typeof taskIdSchema>;

export interface TokenCeilings {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export interface TaskRoute extends TokenCeilings {
  readonly tier: Tier;
  /**
   * conversation.turn is pitched differently at each level, so its ceilings
   * are too. Everything else uses one pair.
   */
  readonly byLevel?: Readonly<Record<CEFRLevel, TokenCeilings>>;
}

const ROUTES: Readonly<Record<TaskId, TaskRoute>> = {
  "conversation.turn": {
    tier: "strong",
    maxInputTokens: 6000,
    maxOutputTokens: 700,
    byLevel: {
      A1: { maxInputTokens: 4000, maxOutputTokens: 300 },
      A2: { maxInputTokens: 5000, maxOutputTokens: 450 },
      B1: { maxInputTokens: 6000, maxOutputTokens: 700 },
    },
  },
  "conversation.repair": { tier: "strong", maxInputTokens: 6000, maxOutputTokens: 700 },
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
   */
  "trainer.session": { tier: "strong", maxInputTokens: 6000, maxOutputTokens: 1000 },
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
};

export function routeFor(task: TaskId): TaskRoute {
  return ROUTES[task];
}

/** The ceilings a task runs under, narrowed by level where the task varies. */
export function ceilingsFor(task: TaskId, level?: CEFRLevel): TokenCeilings {
  const route = ROUTES[task];
  const scoped = level && route.byLevel ? route.byLevel[level] : undefined;

  return scoped ?? {
    maxInputTokens: route.maxInputTokens,
    maxOutputTokens: route.maxOutputTokens,
  };
}

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
