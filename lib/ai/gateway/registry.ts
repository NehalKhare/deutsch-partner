import type { AppEnv } from "@/lib/env/schema";
import { TIERS, type Tier } from "@/lib/ai/tasks";

/**
 * The model registry.
 *
 * This is the one file in the application allowed to name a model. Everywhere
 * else says "strong" or "nano", which is what makes swapping a model an
 * operations change rather than a code change, and what makes the routing
 * table meaningful at all.
 *
 * Every id below was checked against OpenRouter's live model list on the date
 * stamped here. They are defaults, not commitments: each is overridable per
 * environment, because availability and pricing move and a stale hardcoded
 * assumption is a production incident rather than a stale comment.
 *
 * Prices are deliberately absent. They come from the provider's model list
 * with a fetched_at stamp (see pricing.ts); a literal here is a number that
 * goes quietly wrong.
 */

export const MODEL_IDS_VERIFIED_ON = "2026-08-21";

export type ModelProvider = "openrouter" | "openai";

export interface ModelEntry {
  readonly tier: Tier;
  readonly provider: ModelProvider;
  readonly modelId: string;
  /** Same-tier alternates, tried in order. Never a cost escalation. */
  readonly fallbacks: readonly string[];
  /** The tier's absolute maxima. A task's ceilings must fit inside these. */
  readonly hardMaxInputTokens: number;
  readonly hardMaxOutputTokens: number;
  readonly contextWindow: number;
  /**
   * Vector width, for the embedding tier only. Configurable per the business
   * objective, but not at runtime: the stored column has a fixed width, so
   * changing this is a migration and a re-ingestion.
   */
  readonly dimensions?: number;
}

/**
 * The tiers that carry chat traffic. OpenRouter serves these and the
 * embedding tier; only speech-to-text and speech go direct to their own
 * provider behind their own interfaces.
 */
export const CHAT_TIERS = ["reasoning", "strong", "mid", "cheap", "nano"] as const;

const DEFAULTS: Readonly<Record<Tier, ModelEntry>> = {
  reasoning: {
    tier: "reasoning",
    provider: "openrouter",
    modelId: "anthropic/claude-opus-5",
    fallbacks: ["openai/gpt-5.5"],
    hardMaxInputTokens: 12_000,
    hardMaxOutputTokens: 2_000,
    contextWindow: 1_000_000,
  },
  strong: {
    tier: "strong",
    provider: "openrouter",
    modelId: "anthropic/claude-sonnet-5",
    fallbacks: ["openai/gpt-5.4"],
    hardMaxInputTokens: 8_000,
    hardMaxOutputTokens: 1_000,
    contextWindow: 1_000_000,
  },
  mid: {
    tier: "mid",
    provider: "openrouter",
    modelId: "google/gemini-3.7-flash",
    fallbacks: ["openai/gpt-5.4-mini"],
    hardMaxInputTokens: 6_000,
    hardMaxOutputTokens: 1_000,
    contextWindow: 1_000_000,
  },
  cheap: {
    tier: "cheap",
    provider: "openrouter",
    modelId: "openai/gpt-5-mini",
    fallbacks: ["google/gemini-3.1-flash-lite"],
    hardMaxInputTokens: 8_000,
    hardMaxOutputTokens: 600,
    contextWindow: 400_000,
  },
  nano: {
    tier: "nano",
    provider: "openrouter",
    modelId: "openai/gpt-5-nano",
    fallbacks: ["google/gemini-2.5-flash-lite"],
    hardMaxInputTokens: 2_000,
    hardMaxOutputTokens: 50,
    contextWindow: 400_000,
  },
  // The token figures describe the text side of each: an embedding call has
  // no completion, and a transcription has no prompt. Embeddings ride
  // OpenRouter like chat; only the two speech tiers below go direct.
  embedding: {
    tier: "embedding",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    fallbacks: [],
    hardMaxInputTokens: 8_191,
    hardMaxOutputTokens: 0,
    contextWindow: 8_191,
    dimensions: 1_536,
  },
  stt: {
    tier: "stt",
    provider: "openai",
    modelId: "openai/whisper-1",
    fallbacks: [],
    hardMaxInputTokens: 0,
    hardMaxOutputTokens: 4_096,
    contextWindow: 4_096,
  },
  tts: {
    tier: "tts",
    provider: "openai",
    modelId: "openai/gpt-4o-mini-tts",
    fallbacks: [],
    hardMaxInputTokens: 4_096,
    hardMaxOutputTokens: 0,
    contextWindow: 4_096,
  },
};

export type TierOverrides = Partial<Record<Tier, string>>;

export interface ModelRegistry {
  forTier(tier: Tier): ModelEntry;
  /** The primary first, then the same-tier fallbacks, in the order to try. */
  candidates(tier: Tier): readonly string[];
  tiers(): readonly Tier[];
}

const MODEL_ID_PATTERN = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

export function createModelRegistry(overrides: TierOverrides = {}): ModelRegistry {
  const entries = new Map<Tier, ModelEntry>();

  for (const tier of TIERS) {
    const override = overrides[tier];

    if (override !== undefined && !MODEL_ID_PATTERN.test(override.trim())) {
      throw new Error(
        `${tier}: "${override}" is not a provider-qualified model id such as "vendor/model"`,
      );
    }

    const base = DEFAULTS[tier];
    // Only the primary is overridable. Replacing the fallbacks too would let
    // an operator swapping one model silently remove the ladder beneath it.
    entries.set(tier, override ? { ...base, modelId: override.trim() } : base);
  }

  return {
    forTier: (tier) => entries.get(tier) as ModelEntry,
    candidates: (tier) => {
      const entry = entries.get(tier) as ModelEntry;
      return [entry.modelId, ...entry.fallbacks.filter((id) => id !== entry.modelId)];
    },
    tiers: () => TIERS,
  };
}

/** Maps the validated environment onto the registry's override shape. */
export function registryOverridesFromEnv(env: AppEnv): TierOverrides {
  const byTier: Readonly<Record<Tier, string | undefined>> = {
    reasoning: env.OPENROUTER_MODEL_REASONING,
    strong: env.OPENROUTER_MODEL_STRONG,
    mid: env.OPENROUTER_MODEL_MID,
    cheap: env.OPENROUTER_MODEL_CHEAP,
    nano: env.OPENROUTER_MODEL_NANO,
    embedding: env.EMBEDDING_MODEL,
    stt: env.SPEECH_TO_TEXT_MODEL,
    tts: env.TEXT_TO_SPEECH_MODEL,
  };

  const overrides: TierOverrides = {};
  for (const tier of TIERS) {
    const value = byTier[tier];
    if (value !== undefined) overrides[tier] = value;
  }

  return overrides;
}

/**
 * The next tier down, or null at the bottom.
 *
 * Downward is the preferred degradation under budget pressure and needs no
 * permission. Upward is an escalation, needs a per-task allowlist, and is
 * recorded on the ledger row — see ESCALATION_ALLOWLIST.
 */
export function downgradeTier(tier: Tier): Tier | null {
  const index = CHAT_TIERS.indexOf(tier as (typeof CHAT_TIERS)[number]);

  if (index === -1) return null;
  return CHAT_TIERS[index + 1] ?? null;
}
