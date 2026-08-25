import { describe, expect, it } from "vitest";

import { createTurnBudget } from "@/lib/ai/gateway/budgeter";
import {
  TrainerBudgetExhausted,
  createTrainerChatModel,
  createTrainerModelLadder,
  isModelUnavailableError,
} from "@/lib/ai/gateway/langchain-model";
import { parseEnv } from "@/lib/env/schema";
import type {
  BudgetIncrement,
  LedgerRow,
  LedgerWriteResult,
} from "@/lib/ai/gateway/ledger";
import type { UsageAccounting } from "@/repositories/usage-repository";

/**
 * The LangChain face of the gateway.
 *
 * No network and no real model: what matters here is the accounting seam —
 * that every invocation the agent framework makes leaves exactly one ledger
 * row, prices itself honestly, counts against the request's euro ceiling,
 * and that an exhausted ceiling stops the next iteration cold. The callback
 * is driven directly, which is exactly how LangChain drives it.
 */

const ENV = parseEnv({
  OPENROUTER_API_KEY: "openrouter-key-long-enough",
  FX_EUR_PER_USD_BOOTSTRAP: "0.9",
});

function fakeAccounting(options: { rateUsdPerToken?: number } = {}) {
  const rows: LedgerRow[] = [];
  const increments: BudgetIncrement[][] = [];

  const accounting: UsageAccounting = {
    async record(row, rowIncrements): Promise<LedgerWriteResult> {
      rows.push(row);
      increments.push([...rowIncrements]);
      return { ok: true, id: rows.length };
    },
    async snapshot() {
      return [];
    },
    async latestOnOrBefore() {
      return null; // The bootstrap rate carries pricing in these tests.
    },
    async latestFor(provider, modelId) {
      if (options.rateUsdPerToken === undefined) return null;
      return {
        provider,
        modelId,
        inputRate: options.rateUsdPerToken,
        outputRate: options.rateUsdPerToken,
        currency: "USD",
        fetchedAt: new Date("2026-08-24T00:00:00.000Z"),
      };
    },
  };

  return { accounting, rows, increments };
}

const IDENTITY = {
  name: "trainer.session",
  version: 1,
  fingerprint: "abcd1234",
};

function modelWith(
  accounting: UsageAccounting,
  turn = createTurnBudget(0.05),
  env = ENV,
) {
  const created = createTrainerChatModel(
    { env, accounting, now: () => new Date("2026-08-24T12:00:00.000Z") },
    {
      requestId: "33333333-3333-4333-8333-333333333333",
      userIdHash: "hash-alice",
      turn,
      prompt: IDENTITY,
    },
  );

  const callbacks = created.model.callbacks as Array<{
    handleLLMStart: (llm: unknown, prompts: string[], runId: string) => Promise<void>;
    handleLLMEnd: (output: unknown, runId: string) => Promise<void>;
    handleLLMError: (error: unknown, runId: string) => Promise<void>;
  }>;

  return { ...created, turn, handler: callbacks[0]! };
}

const OUTPUT = (over: Record<string, unknown> = {}) => ({
  generations: [],
  llmOutput: {
    tokenUsage: { promptTokens: 900, completionTokens: 120 },
    ...over,
  },
});

describe("what the factory resolves", () => {
  it("takes the tier and model from the task table and the registry", () => {
    const { accounting } = fakeAccounting();
    const created = modelWith(accounting);

    expect(created.tier).toBe("mid");
    // The registry's mid-tier default; this file itself names no model.
    expect(created.modelId).toContain("/");
  });

  it("honours the per-tier registry override", () => {
    const { accounting } = fakeAccounting();
    const env = parseEnv({
      OPENROUTER_API_KEY: "openrouter-key-long-enough",
      OPENROUTER_MODEL_MID: "vendor/custom-model",
    });

    expect(modelWith(accounting, createTurnBudget(0.05), env).modelId).toBe(
      "vendor/custom-model",
    );
  });

  it("refuses to build without the OpenRouter key", () => {
    const { accounting } = fakeAccounting();

    expect(() => modelWith(accounting, createTurnBudget(0.05), parseEnv({}))).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });
});

describe("the ladder", () => {
  // OpenRouter's account data policy can leave a model with no endpoint at
  // all; the ladder is what the Trainer walks down when that happens.
  it("lists the tier's primary first, then its same-tier fallbacks", () => {
    const { accounting } = fakeAccounting();
    const ladder = createTrainerModelLadder(
      { env: ENV, accounting },
      {
        requestId: "33333333-3333-4333-8333-333333333333",
        userIdHash: "hash-user",
        turn: createTurnBudget(0.05),
        prompt: IDENTITY,
      },
    );

    expect(ladder.length).toBeGreaterThan(1);
    expect(new Set(ladder.map((entry) => entry.modelId)).size).toBe(ladder.length);
    for (const entry of ladder) expect(entry.tier).toBe("mid");
  });

  it("puts an overridden primary at the top without losing the fallbacks", () => {
    const { accounting } = fakeAccounting();
    const env = parseEnv({
      OPENROUTER_API_KEY: "openrouter-key-long-enough",
      OPENROUTER_MODEL_MID: "vendor/custom-model",
    });
    const ladder = createTrainerModelLadder(
      { env, accounting },
      {
        requestId: "33333333-3333-4333-8333-333333333333",
        userIdHash: "hash-user",
        turn: createTurnBudget(0.05),
        prompt: IDENTITY,
      },
    );

    expect(ladder[0]?.modelId).toBe("vendor/custom-model");
    expect(ladder.length).toBeGreaterThan(1);
  });
});

describe("what counts as a model without an endpoint", () => {
  it("recognises the provider's 404 and LangChain's model-not-found code", () => {
    expect(
      isModelUnavailableError(Object.assign(new Error("404"), { status: 404 })),
    ).toBe(true);
    expect(
      isModelUnavailableError(
        Object.assign(new Error("x"), { lc_error_code: "MODEL_NOT_FOUND" }),
      ),
    ).toBe(true);
  });

  it("leaves every other failure to fail the turn", () => {
    expect(
      isModelUnavailableError(Object.assign(new Error("500"), { status: 500 })),
    ).toBe(false);
    expect(isModelUnavailableError(new TrainerBudgetExhausted(0.05))).toBe(false);
    expect(isModelUnavailableError("boom")).toBe(false);
    expect(isModelUnavailableError(null)).toBe(false);
  });
});

describe("the ledger seam", () => {
  it("writes exactly one row per invocation, stamped with the task and prompt", async () => {
    const { accounting, rows } = fakeAccounting();
    const { handler } = modelWith(accounting);

    await handler.handleLLMStart({}, [], "run-1");
    await handler.handleLLMEnd(OUTPUT(), "run-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task: "trainer.session",
      tier: "mid",
      promptName: "trainer.session",
      promptVersion: 1,
      promptFingerprint: "abcd1234",
      inputTokens: 900,
      outputTokens: 120,
      status: "ok",
      attemptNumber: 1,
    });
  });

  it("prefers the provider's own dollar figure when it reported one", async () => {
    const { accounting, rows } = fakeAccounting();
    const { handler } = modelWith(accounting);

    await handler.handleLLMStart({}, [], "run-1");
    await handler.handleLLMEnd(OUTPUT({ usage: { cost: 0.004 } }), "run-1");

    expect(rows[0]?.costUsd).toBe(0.004);
    // Priced at the bootstrap rate of 0.9 euro per dollar.
    expect(rows[0]?.costEur).toBeCloseTo(0.0036);
  });

  it("falls back to the pricing store when the provider stayed silent", async () => {
    const { accounting, rows } = fakeAccounting({ rateUsdPerToken: 0.000001 });
    const { handler } = modelWith(accounting);

    await handler.handleLLMStart({}, [], "run-1");
    await handler.handleLLMEnd(OUTPUT(), "run-1");

    // (900 + 120) tokens at a dollar a million.
    expect(rows[0]?.costUsd).toBeCloseTo(0.00102);
  });

  it("counts every invocation against the request's euro ceiling", async () => {
    const { accounting } = fakeAccounting();
    const turn = createTurnBudget(0.05);
    const { handler } = modelWith(accounting, turn);

    await handler.handleLLMStart({}, [], "run-1");
    await handler.handleLLMEnd(OUTPUT({ usage: { cost: 0.01 } }), "run-1");

    expect(turn.spentEur()).toBeCloseTo(0.009);
  });

  it("numbers attempts across the loop", async () => {
    const { accounting, rows } = fakeAccounting();
    const { handler } = modelWith(accounting);

    await handler.handleLLMStart({}, [], "run-1");
    await handler.handleLLMEnd(OUTPUT(), "run-1");
    await handler.handleLLMStart({}, [], "run-2");
    await handler.handleLLMEnd(OUTPUT(), "run-2");

    expect(rows.map((row) => row.attemptNumber)).toEqual([1, 2]);
  });

  it("writes an error row for a failed invocation, with a name and no message", async () => {
    const { accounting, rows } = fakeAccounting();
    const { handler } = modelWith(accounting);

    const failure = new Error("the provider quoted the whole prompt back");
    failure.name = "APIConnectionError";
    await handler.handleLLMStart({}, [], "run-1");
    await handler.handleLLMError(failure, "run-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "error", errorCode: "APIConnectionError" });
    expect(JSON.stringify(rows[0])).not.toContain("quoted the whole prompt");
  });
});

describe("the euro ceiling", () => {
  it("stops the next iteration once the budget is spent", async () => {
    const { accounting } = fakeAccounting();
    const turn = createTurnBudget(0.001);
    const { handler } = modelWith(accounting, turn);

    turn.record(0.001);

    await expect(handler.handleLLMStart({}, [], "run-2")).rejects.toBeInstanceOf(
      TrainerBudgetExhausted,
    );
  });

  it("does not write a second row for the refusal itself", async () => {
    const { accounting, rows } = fakeAccounting();
    const turn = createTurnBudget(0);
    const { handler } = modelWith(accounting, turn);

    await expect(handler.handleLLMStart({}, [], "run-1")).rejects.toThrow();
    await handler.handleLLMError(new TrainerBudgetExhausted(0), "run-1");

    expect(rows).toHaveLength(0);
  });
});
