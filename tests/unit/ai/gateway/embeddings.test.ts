import { describe, expect, it, vi } from "vitest";

import type { BudgetSnapshot, BudgetSource } from "@/lib/ai/gateway/budget-gate";
import {
  createEmbeddingGateway,
  embeddingSpecFor,
  type EmbeddingCallSpec,
  type EmbeddingTransport,
} from "@/lib/ai/gateway/embeddings";
import { createFxRateService } from "@/lib/ai/gateway/fx";
import type { LedgerRow, UsageLedger } from "@/lib/ai/gateway/ledger";
import { createModelRegistry } from "@/lib/ai/gateway/registry";
import { createLogger } from "@/lib/observability/logger";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const CONTEXT = { requestId: null, userIdHash: "hash-alice" };

const vector = (seed: number, width = 1536) =>
  Array.from({ length: width }, (_value, index) => (seed + index) % 7);

function spec(over: Partial<EmbeddingCallSpec> = {}): EmbeddingCallSpec {
  const built = embeddingSpecFor("ingestion.embedding", {
    timeoutMs: 20_000,
    dimensions: 1536,
  });
  if (!built.ok) throw new Error("fixture spec did not build");
  return { ...built.data, ...over };
}

function recordingLedger() {
  const rows: LedgerRow[] = [];
  const ledger: UsageLedger = {
    async record(row) {
      rows.push(row);
      return { ok: true, id: rows.length };
    },
  };
  return { ledger, rows };
}

const openBudget: BudgetSource = {
  async snapshot() {
    return [] as BudgetSnapshot[];
  },
};

function harness(
  over: { transport?: EmbeddingTransport; budgets?: BudgetSource; sink?: (l: string) => void } = {},
) {
  const { ledger, rows } = recordingLedger();
  const transport: EmbeddingTransport = over.transport ?? {
    async embed(request) {
      return {
        vectors: request.texts.map((_text, index) => vector(index)),
        usage: {
          inputTokens: 40,
          costUsd: null,
          modelIdResolved: "text-embedding-3-small",
        },
      };
    },
  };

  const gateway = createEmbeddingGateway({
    registry: createModelRegistry(),
    transport,
    ledger,
    budgets: over.budgets ?? openBudget,
    fx: createFxRateService({
      async latestOnOrBefore() {
        return { eurPerUsd: 0.92, rateDate: "2026-08-21", source: "ecb" };
      },
    }),
    pricing: {
      async latestFor(provider, modelId) {
        return {
          provider,
          modelId,
          inputRate: 0.00000002,
          outputRate: 0,
          currency: "USD",
          fetchedAt: NOW,
        };
      },
    },
    logger: createLogger({ sink: over.sink ?? (() => {}) }),
    now: () => NOW,
  });

  return { gateway, rows, transport };
}

describe("the embedding call spec", () => {
  it("derives the tier and ceiling from the routing table", () => {
    const built = embeddingSpecFor("ingestion.embedding", {
      timeoutMs: 20_000,
      dimensions: 1536,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.data.tier).toBe("embedding");
    expect(built.data.maxInputTokens).toBe(8191);
  });

  it("refuses a task that is not an embedding task", () => {
    expect(
      embeddingSpecFor("conversation.turn", { timeoutMs: 1000, dimensions: 1536 }),
    ).toMatchObject({ ok: false, failure: "invalid_spec" });
  });

  it("refuses an unknown task", () => {
    expect(
      embeddingSpecFor("ingestion.vectors", { timeoutMs: 1000, dimensions: 1536 }),
    ).toMatchObject({ ok: false, failure: "unknown_task" });
  });
});

describe("embedding through the gateway", () => {
  it("returns one vector per text, in order", async () => {
    const { gateway } = harness();

    const outcome = await gateway.embed(spec(), ["eins", "zwei", "drei"], CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.vectors).toHaveLength(3);
    expect(outcome.data.vectors[1]).toEqual(vector(1));
  });

  it("writes exactly one ledger row", async () => {
    const { gateway, rows } = harness();

    await gateway.embed(spec(), ["eins"], CONTEXT);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task: "ingestion.embedding",
      tier: "embedding",
      status: "ok",
      maxOutputTokens: 0,
      outputTokens: 0,
      inputTokens: 40,
    });
  });

  it("prices it from the cached snapshot, since the API reports no cost", async () => {
    const { gateway, rows } = harness();

    await gateway.embed(spec(), ["eins"], CONTEXT);

    expect(rows[0].costUsd).toBeCloseTo(0.0000008, 12);
    // Rounded to the eight decimal places the ledger column stores, at write
    // time. A single embedding costs less than the column can express, which
    // is why the counters that matter are aggregates.
    expect(rows[0].costEur).toBe(0.00000074);
  });

  it("makes no request and writes no row for an empty batch", async () => {
    const embed = vi.fn();
    const { gateway, rows } = harness({ transport: { embed } });

    const outcome = await gateway.embed(spec(), [], CONTEXT);

    expect(outcome.ok).toBe(true);
    expect(embed).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("refuses a batch larger than the spec allows", async () => {
    const { gateway } = harness();

    const outcome = await gateway.embed(
      spec({ maxBatchSize: 2 }),
      ["a", "b", "c"],
      CONTEXT,
    );

    expect(outcome).toMatchObject({ ok: false, failure: "invalid_spec" });
  });

  it("denies a text over the per-text ceiling and records it", async () => {
    const embed = vi.fn();
    const { gateway, rows } = harness({ transport: { embed } });

    const outcome = await gateway.embed(
      spec({ maxInputTokens: 10 }),
      ["kurz", "Wort ".repeat(500)],
      CONTEXT,
    );

    expect(outcome).toMatchObject({ ok: false, failure: "ceiling_denied" });
    expect(embed).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "ceiling_denied", maxOutputTokens: 0 });
  });

  it("refuses a vector of the wrong width rather than storing it", async () => {
    // A short vector poisons every similarity score it later takes part in.
    const { gateway, rows } = harness({
      transport: {
        async embed() {
          return {
            vectors: [vector(0, 512)],
            usage: { inputTokens: 4, costUsd: null, modelIdResolved: "m" },
          };
        },
      },
    });

    const outcome = await gateway.embed(spec(), ["eins"], CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "provider_error" });
    expect(rows[0].status).toBe("error");
  });

  it("refuses a response with the wrong number of vectors", async () => {
    const { gateway } = harness({
      transport: {
        async embed() {
          return {
            vectors: [vector(0)],
            usage: { inputTokens: 4, costUsd: null, modelIdResolved: "m" },
          };
        },
      },
    });

    expect(await gateway.embed(spec(), ["eins", "zwei"], CONTEXT)).toMatchObject({
      ok: false,
      failure: "provider_error",
    });
  });

  it("denies when the budget is exhausted and makes no request", async () => {
    const embed = vi.fn();
    const { gateway, rows } = harness({
      transport: { embed },
      budgets: {
        async snapshot() {
          return [
            {
              scope: "global_daily" as const,
              scopeKey: null,
              limitEur: 1,
              spentEur: 1,
              warnPct: 0.7,
              degradePct: 0.9,
            },
          ];
        },
      },
    });

    const outcome = await gateway.embed(spec(), ["eins"], CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "budget_denied" });
    expect(embed).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({
      status: "budget_denied",
      budgetScopeHit: "global_daily",
    });
  });

  it("fails closed when the counters cannot be read", async () => {
    const { gateway } = harness({ budgets: { async snapshot() { return null; } } });

    expect(await gateway.embed(spec(), ["eins"], CONTEXT)).toMatchObject({
      ok: false,
      failure: "budget_denied",
    });
  });

  it("records a provider failure as its own row", async () => {
    const { gateway, rows } = harness({
      transport: {
        async embed() {
          throw new Error("upstream 503");
        },
      },
    });

    const outcome = await gateway.embed(spec(), ["eins"], CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "provider_error" });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("error");
  });

  it("writes no text into the ledger", async () => {
    const { gateway, rows } = harness();

    await gateway.embed(spec(), ["Ich hätte gern einen Kaffee."], CONTEXT);

    expect(JSON.stringify(rows[0])).not.toContain("Kaffee");
  });
});
