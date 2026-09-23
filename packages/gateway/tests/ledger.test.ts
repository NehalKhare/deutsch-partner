import { describe, expect, it } from "vitest";

import { LEDGER_STATUSES } from "../src/errors";
import { applyFx, ledgerRowSchema, type LedgerRow } from "../src/ledger";

function completeRow(over: Partial<LedgerRow> = {}): unknown {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    traceId: "trace-1",
    spanId: "span-1",
    userIdHash: "5f4dcc3b5aa765d61d8327deb882cf99",
    threadId: null,
    messageId: null,
    task: "conversation.turn",
    tier: "strong",
    promptName: "conversation.turn",
    promptVersion: 1,
    promptFingerprint: "abcd1234",
    provider: "openrouter",
    modelId: "vendor/model",
    modelIdResolved: "vendor/model-2026-01",
    inputTokens: 900,
    outputTokens: 120,
    reasoningTokens: null,
    cachedInputTokens: 400,
    maxOutputTokens: 300,
    truncated: false,
    escalated: false,
    degraded: false,
    budgetScopeHit: null,
    attemptNumber: 1,
    latencyMs: 1400,
    firstTokenMs: 320,
    status: "ok",
    errorCode: null,
    costUsd: 0.0021,
    fxRateEurPerUsd: 0.92,
    fxStale: false,
    costEur: 0.001932,
    ...over,
  };
}

describe("ledger row", () => {
  it("accepts a complete row", () => {
    expect(ledgerRowSchema.safeParse(completeRow()).success).toBe(true);
  });

  it.each([
    "task",
    "tier",
    "provider",
    "modelId",
    "modelIdResolved",
    "maxOutputTokens",
    "status",
    "attemptNumber",
  ])("requires %s", (key) => {
    const row = completeRow() as Record<string, unknown>;
    delete row[key];

    expect(ledgerRowSchema.safeParse(row).success).toBe(false);
  });

  it.each(["content", "message", "userMessage", "transcript", "prompt", "completion", "email"])(
    "refuses a row carrying %s",
    (key) => {
      const parsed = ledgerRowSchema.safeParse({
        ...(completeRow() as object),
        [key]: "Ich möchte einen Kaffee bestellen.",
      });

      expect(parsed.success).toBe(false);
    },
  );

  it("declares no field that could hold conversation content", () => {
    const keys = Object.keys(ledgerRowSchema.shape);
    const contentShaped = /content|message(?!Id)|utterance|transcript|prompt(?!Name|Version|Fingerprint)|text|email/i;

    expect(keys.filter((key) => contentShaped.test(key))).toEqual([]);
  });

  it("carries every status the accounting section requires", () => {
    expect([...LEDGER_STATUSES]).toEqual([
      "ok",
      "error",
      "timeout",
      "budget_denied",
      "ceiling_denied",
    ]);

    for (const status of LEDGER_STATUSES) {
      expect(ledgerRowSchema.safeParse(completeRow({ status })).success).toBe(true);
    }
  });

  it("rejects a status outside that set", () => {
    expect(ledgerRowSchema.safeParse(completeRow({ status: "degraded" as never })).success).toBe(
      false,
    );
  });

  it("rejects a euro figure without the rate that produced it", () => {
    // A euro number with no stated rate is not auditable.
    expect(
      ledgerRowSchema.safeParse(
        completeRow({ fxRateEurPerUsd: null, fxStale: true, costEur: 0.0019 }),
      ).success,
    ).toBe(false);
  });

  it("accepts an unpriced row that says so", () => {
    expect(
      ledgerRowSchema.safeParse(
        completeRow({ fxRateEurPerUsd: null, fxStale: true, costEur: 0 }),
      ).success,
    ).toBe(true);
  });

  it("refuses a chat row with no output ceiling", () => {
    expect(ledgerRowSchema.safeParse(completeRow({ maxOutputTokens: 0 })).success).toBe(
      false,
    );
  });

  it("accepts an embedding row, which has no output ceiling to state", () => {
    expect(
      ledgerRowSchema.safeParse(
        completeRow({
          task: "ingestion.embedding",
          tier: "embedding",
          maxOutputTokens: 0,
          outputTokens: 0,
        }),
      ).success,
    ).toBe(true);
  });

  it("refuses an embedding row claiming an output ceiling", () => {
    expect(
      ledgerRowSchema.safeParse(
        completeRow({ task: "ingestion.embedding", tier: "embedding" }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unpriced row that forgot to flag itself", () => {
    expect(
      ledgerRowSchema.safeParse(
        completeRow({ fxRateEurPerUsd: null, fxStale: false, costEur: 0 }),
      ).success,
    ).toBe(false);
  });
});

describe("applyFx", () => {
  const rate = { eurPerUsd: 0.92, rateDate: "2026-08-21", source: "ecb", stale: false };

  it("converts at write time and keeps the rate on the row", () => {
    expect(applyFx(0.01, rate)).toEqual({
      costUsd: 0.01,
      fxRateEurPerUsd: 0.92,
      fxStale: false,
      costEur: 0.0092,
    });
  });

  it("marks a carried-forward rate stale on the row that used it", () => {
    expect(applyFx(0.01, { ...rate, stale: true })).toMatchObject({
      fxStale: true,
      fxRateEurPerUsd: 0.92,
    });
  });

  it("records the dollars exactly when no rate is available", () => {
    expect(applyFx(0.01, null)).toEqual({
      costUsd: 0.01,
      fxRateEurPerUsd: null,
      fxStale: true,
      costEur: 0,
    });
  });
});
