import { describe, expect, it } from "vitest";

import {
  CHAT_TIERS,
  createModelRegistry,
  downgradeTier,
  registryOverridesFromEnv,
} from "@/lib/ai/gateway/registry";
import { TASK_IDS, TIERS, ceilingsFor, routeFor, type Tier } from "@/lib/ai/tasks";
import { parseEnv } from "@/lib/env/schema";

const registry = createModelRegistry();

describe("model registry", () => {
  it.each(TIERS)("has an entry for the %s tier", (tier) => {
    expect(registry.forTier(tier).modelId).toMatch(/\S/);
  });

  it("puts the primary model first among the candidates", () => {
    for (const tier of TIERS) {
      const entry = registry.forTier(tier);
      expect(registry.candidates(tier)[0]).toBe(entry.modelId);
      expect(registry.candidates(tier)).toHaveLength(entry.fallbacks.length + 1);
    }
  });

  it("never lists a model twice within a tier", () => {
    for (const tier of TIERS) {
      const candidates = registry.candidates(tier);
      expect(new Set(candidates).size).toBe(candidates.length);
    }
  });

  it("gives every chat tier at least one fallback", () => {
    for (const tier of CHAT_TIERS) {
      expect(registry.forTier(tier).fallbacks.length).toBeGreaterThan(0);
    }
  });

  it("sends chat and embedding traffic through OpenRouter", () => {
    // One key for everything the text product does: chat, completion and
    // embeddings all ride the router.
    for (const tier of [...CHAT_TIERS, "embedding"] as const) {
      expect(registry.forTier(tier).provider).toBe("openrouter");
    }
  });

  it("keeps speech-to-text and speech off OpenRouter", () => {
    // OpenRouter serves no speech model. Routing them there would fail at
    // runtime and hide the fact that they have their own provider.
    for (const tier of ["stt", "tts"] as const) {
      expect(registry.forTier(tier).provider).not.toBe("openrouter");
    }
  });

  it("gives every tier headroom for the largest task routed to it", () => {
    // A tier whose hard ceiling sits under a task's ceiling is a call that can
    // only ever be denied, discovered in production rather than here.
    for (const task of TASK_IDS) {
      const tier = routeFor(task).tier;
      const entry = registry.forTier(tier);
      const ceilings = ceilingsFor(task);

      expect(entry.hardMaxOutputTokens, `${task} output`).toBeGreaterThanOrEqual(
        ceilings.maxOutputTokens,
      );
      expect(entry.hardMaxInputTokens, `${task} input`).toBeGreaterThanOrEqual(
        ceilings.maxInputTokens,
      );
    }
  });

  it("keeps each tier's ceilings inside the model's context window", () => {
    for (const tier of TIERS) {
      const entry = registry.forTier(tier);
      expect(entry.hardMaxInputTokens + entry.hardMaxOutputTokens).toBeLessThanOrEqual(
        entry.contextWindow,
      );
    }
  });

  it("takes a per-environment override for the primary model", () => {
    const overridden = createModelRegistry({ nano: "vendor/other-nano" });

    expect(overridden.forTier("nano").modelId).toBe("vendor/other-nano");
    // The fallbacks are the registry's, not the environment's: an operator
    // swapping a primary should not silently lose the ladder beneath it.
    expect(overridden.forTier("nano").fallbacks).toEqual(
      registry.forTier("nano").fallbacks,
    );
  });

  it("refuses an override that is not shaped like a model id", () => {
    for (const bad of ["", "  ", "no-slash", "vendor/", "/model"]) {
      expect(() => createModelRegistry({ nano: bad })).toThrow(/model id/i);
    }
  });

  it("leaves the shared registry untouched when one is overridden", () => {
    createModelRegistry({ strong: "vendor/replacement" });

    expect(registry.forTier("strong").modelId).not.toBe("vendor/replacement");
  });

  it("reads overrides out of the validated environment", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      OPENROUTER_MODEL_STRONG: "vendor/strong-1",
      OPENROUTER_MODEL_NANO: "vendor/nano-1",
    });

    expect(registryOverridesFromEnv(env)).toEqual({
      strong: "vendor/strong-1",
      nano: "vendor/nano-1",
    });
  });

  it("returns no overrides when the environment names none", () => {
    expect(registryOverridesFromEnv(parseEnv({ NODE_ENV: "test" }))).toEqual({});
  });
});

describe("tier ordering", () => {
  it("walks downward one step at a time and stops at the cheapest", () => {
    const walked: Tier[] = [];
    let tier: Tier | null = "reasoning";

    while (tier) {
      walked.push(tier);
      tier = downgradeTier(tier);
    }

    expect(walked).toEqual(["reasoning", "strong", "mid", "cheap", "nano"]);
  });

  it("has nothing below nano", () => {
    expect(downgradeTier("nano")).toBeNull();
  });

  it("refuses to downgrade a tier that is not a chat tier", () => {
    // Downgrading an embedding call to a nano chat model is nonsense, not a
    // saving.
    expect(downgradeTier("embedding")).toBeNull();
  });
});
