import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  callSpecFor,
  modelCallSpecSchema,
  withLoweredOutputCeiling,
} from "@/lib/ai/gateway/call-spec";

const LABEL = z.object({ label: z.string() });

/** A spec that passes, so each test below can remove exactly one thing. */
function validSpec() {
  return {
    task: "conversation.turn" as const,
    tier: "strong" as const,
    maxInputTokens: 4000,
    maxOutputTokens: 300,
    timeoutMs: 30_000,
    outputSchema: undefined,
  };
}

describe("model call spec", () => {
  it("accepts a complete spec", () => {
    expect(modelCallSpecSchema.safeParse(validSpec()).success).toBe(true);
  });

  it("fails validation when maxOutputTokens is missing", () => {
    const { maxOutputTokens: _dropped, ...spec } = validSpec();

    const parsed = modelCallSpecSchema.safeParse(spec);

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("maxOutputTokens");
  });

  it("fails validation when maxInputTokens is missing", () => {
    const { maxInputTokens: _dropped, ...spec } = validSpec();

    const parsed = modelCallSpecSchema.safeParse(spec);

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("maxInputTokens");
  });

  it("fails validation when timeoutMs is missing", () => {
    const { timeoutMs: _dropped, ...spec } = validSpec();

    expect(modelCallSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("refuses a tier the task does not route to", () => {
    const parsed = modelCallSpecSchema.safeParse({ ...validSpec(), tier: "nano" });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("tier");
  });

  it("refuses an output ceiling above the one the routing table sets", () => {
    const parsed = modelCallSpecSchema.safeParse({
      ...validSpec(),
      maxOutputTokens: 4096,
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses an input ceiling above the one the routing table sets", () => {
    const parsed = modelCallSpecSchema.safeParse({
      ...validSpec(),
      maxInputTokens: 100_000,
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a zero or negative output ceiling", () => {
    for (const value of [0, -1]) {
      expect(
        modelCallSpecSchema.safeParse({ ...validSpec(), maxOutputTokens: value }).success,
      ).toBe(false);
    }
  });

  it("requires a schema for every task that is not a conversation turn", () => {
    const parsed = modelCallSpecSchema.safeParse({
      task: "classification.intent",
      tier: "nano",
      maxInputTokens: 800,
      maxOutputTokens: 20,
      timeoutMs: 5_000,
      outputSchema: undefined,
    });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("outputSchema");
  });

  it("accepts the same task once it declares a schema", () => {
    const parsed = modelCallSpecSchema.safeParse({
      task: "classification.intent",
      tier: "nano",
      maxInputTokens: 800,
      maxOutputTokens: 20,
      timeoutMs: 5_000,
      outputSchema: LABEL,
    });

    expect(parsed.success).toBe(true);
  });
});

describe("callSpecFor", () => {
  it("derives the tier and the ceilings from the task", () => {
    const spec = callSpecFor("conversation.turn", { level: "A2", timeoutMs: 30_000 });

    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.data.tier).toBe("strong");
    expect(spec.data.maxInputTokens).toBe(5000);
    expect(spec.data.maxOutputTokens).toBe(450);
  });

  it("gives a caller no way to name the tier", () => {
    const spec = callSpecFor("classification.intent", {
      timeoutMs: 5_000,
      outputSchema: LABEL,
      // A caller trying to buy a better model for a single-label classifier.
      tier: "strong",
    } as never);

    expect(spec).toMatchObject({ ok: false, failure: "invalid_spec" });
  });

  it("rejects an unknown task before a spec exists", () => {
    expect(callSpecFor("conversation.freestyle", { timeoutMs: 1000 })).toMatchObject({
      ok: false,
      failure: "unknown_task",
    });
  });

  it("lets the degrade path lower an output ceiling", () => {
    const spec = callSpecFor("conversation.turn", { level: "B1", timeoutMs: 30_000 });
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    const lowered = withLoweredOutputCeiling(spec.data, 200);

    expect(lowered.maxOutputTokens).toBe(200);
    expect(modelCallSpecSchema.safeParse(lowered).success).toBe(true);
  });

  it("never lets the degrade path raise one", () => {
    const spec = callSpecFor("conversation.turn", { level: "A1", timeoutMs: 30_000 });
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;

    expect(withLoweredOutputCeiling(spec.data, 5000).maxOutputTokens).toBe(300);
  });

  it("refuses a timeout that is absent or absurd", () => {
    expect(callSpecFor("conversation.turn", {} as never)).toMatchObject({ ok: false });
    expect(
      callSpecFor("conversation.turn", { timeoutMs: 10 * 60_000 }),
    ).toMatchObject({ ok: false, failure: "invalid_spec" });
  });
});
