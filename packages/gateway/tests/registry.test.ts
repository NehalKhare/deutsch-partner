import { describe, expect, it } from "vitest";

import {
  CHAT_TIERS,
  createModelRegistry,
  downgradeTier,
  registryOverridesFromEnv,
} from "../src/registry";
import { CEFR_LEVELS } from "@dp/domain/cefr";
import { PLAN_CODES } from "@dp/domain/plans";
import {
  CHAT_TIER_LADDER,
  TASK_IDS,
  TIERS,
  ceilingsFor,
  maxCeilingsFor,
  routeFor,
  tierFor,
  type Tier,
} from "@dp/domain/tasks";
import { parseEnv } from "@dp/env/schema";

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

  it("routes speech through OpenRouter like everything else", () => {
    // It once could not: the router served no speech model, so voice went
    // direct to OpenAI on a second key. It serves audio-capable chat models
    // now, and a second provider account is a second thing to fund and
    // rotate — so the rule is one key for every model call this app makes.
    for (const tier of ["stt", "tts"] as const) {
      expect(registry.forTier(tier).provider).toBe("openrouter");
    }
  });

  it("tells the small-ceiling tiers not to think before they answer", () => {
    // Their models are reasoning models and their ceilings are 600 and 50
    // output tokens. Left to decide, gpt-5-mini spent all 600 reasoning about
    // a market-research query and returned no text, which the transport
    // could only report as a provider failure. Extraction needs no thinking.
    expect(registry.forTier("cheap").reasoningEffort).toBe("minimal");
    expect(registry.forTier("nano").reasoningEffort).toBe("minimal");
    // Bounded rather than off: the mid tier's structured output wants some
    // understanding, and none of its ceilings can afford unbounded thinking.
    expect(registry.forTier("mid").reasoningEffort).toBe("low");
  });

  it("gives every tier headroom for the largest task routed to it", () => {
    // A tier whose hard ceiling sits under a task's ceiling is a call that can
    // only ever be denied, discovered in production rather than here. The
    // row, not a resolution: it is the most any plan or level reaches.
    for (const task of TASK_IDS) {
      const tier = routeFor(task).tier;
      const entry = registry.forTier(tier);
      const ceilings = maxCeilingsFor(task);

      expect(entry.hardMaxOutputTokens, `${task} output`).toBeGreaterThanOrEqual(
        ceilings.maxOutputTokens,
      );
      expect(entry.hardMaxInputTokens, `${task} input`).toBeGreaterThanOrEqual(
        ceilings.maxInputTokens,
      );
    }
  });

  it("fits every plan's route inside the hard maxima of the tier it runs on", () => {
    // billing-and-plans-spec.md S3. A plan that moves a task down to mid
    // brings its ceilings with it, and mid's maxima are smaller than strong's:
    // a free tutor handed premium's context would be refused on every call.
    for (const task of TASK_IDS) {
      for (const plan of [...PLAN_CODES, undefined]) {
        const entry = registry.forTier(tierFor(task, plan));

        for (const level of [...CEFR_LEVELS, undefined]) {
          const ceilings = ceilingsFor(task, level, plan);
          const label = `${task} ${plan ?? "no plan"} ${level ?? "no level"}`;

          expect(entry.hardMaxInputTokens, `${label} input`).toBeGreaterThanOrEqual(
            ceilings.maxInputTokens,
          );
          expect(entry.hardMaxOutputTokens, `${label} output`).toBeGreaterThanOrEqual(
            ceilings.maxOutputTokens,
          );
        }
      }
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
  it("walks the same ladder the routing table ranks plans on", () => {
    // Degradation and the byPlan rule "down the ladder, never up" must mean the
    // same ladder, or a plan could be "down" by one and "up" by the other.
    expect(CHAT_TIERS).toEqual(CHAT_TIER_LADDER);
  });

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
