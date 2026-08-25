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
   * The Trainer's agent loop. Mid tier on purpose: one request is up to
   * seven model invocations (the step cap plus the final answer), so the
   * strong tier's price would multiply where a coach's judgement does not
   * need it. Each iteration is its own call under these ceilings, and each
   * writes its own ledger row.
   */
  "trainer.session": { tier: "mid", maxInputTokens: 6000, maxOutputTokens: 700 },
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
