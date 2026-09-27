import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { BudgetSnapshot, BudgetSource } from "../src/budget-gate";
import { createTurnBudget } from "../src/budgeter";
import { callSpecFor } from "../src/call-spec";
import { createFxRateService } from "../src/fx";
import { createModelGateway, type GatewayPrompt } from "../src/gateway";
import type { BudgetIncrement, LedgerRow, UsageLedger } from "../src/ledger";
import type {
  CompletionResponse,
  ModelRequest,
  ModelTransport,
  ProviderUsage,
  StreamResponse,
} from "../src/transport";
import { createModelRegistry } from "../src/registry";
import { createLogger } from "@dp/observability/logger";

const NOW = new Date("2026-08-21T12:00:00.000Z");

/** What a fake transport was actually asked for, or nothing if it was not. */
const sentRequests = (transport: ModelTransport): readonly ModelRequest[] =>
  (transport as ModelTransport & { requests?: ModelRequest[] }).requests ?? [];

const PROMPT: GatewayPrompt = {
  system: "Du bist eine Deutschlehrerin.",
  user: "<user_message>\nGuten Tag!\n</user_message>",
  inputTokens: 900,
};

const CONTEXT = {
  requestId: "11111111-1111-4111-8111-111111111111",
  traceId: "trace-1",
  spanId: "span-1",
  userIdHash: "hash-alice",
  threadId: "22222222-2222-4222-8222-222222222222",
  messageId: null,
};

function usage(over: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    inputTokens: 900,
    outputTokens: 120,
    reasoningTokens: null,
    cachedInputTokens: null,
    costUsd: 0.002,
    modelIdResolved: "vendor/model-2026-01",
    ...over,
  };
}

/** A ledger that keeps every row it is handed, so tests can count them. */
function recordingLedger() {
  const rows: LedgerRow[] = [];
  const increments: BudgetIncrement[][] = [];
  const ledger: UsageLedger = {
    async record(row, batch) {
      rows.push(row);
      increments.push([...batch]);
      return { ok: true, id: rows.length };
    },
  };
  return { ledger, rows, increments };
}

function budgetsAt(spent: Record<string, number>): BudgetSource {
  return {
    async snapshot({ userIdHash }) {
      const snapshots: BudgetSnapshot[] = [
        {
          scope: "global_daily",
          scopeKey: null,
          limitEur: 100,
          spentEur: spent.global ?? 0,
          warnPct: 0.7,
          degradePct: 0.9,
        },
        {
          scope: "per_user_daily",
          scopeKey: userIdHash,
          limitEur: 1,
          spentEur: spent[userIdHash ?? ""] ?? 0,
          warnPct: 0.7,
          degradePct: 0.9,
        },
      ];
      return snapshots;
    },
  };
}

function transportReturning(
  text: string,
  over: Partial<ProviderUsage> = {},
): ModelTransport & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      return { text, usage: usage(over), firstTokenMs: 200 } satisfies CompletionResponse;
    },
    async stream(request) {
      requests.push(request);
      async function* chunks() {
        yield text;
      }
      return {
        chunks: chunks(),
        usage: () => usage(over),
        firstTokenMs: () => 200,
      } satisfies StreamResponse;
    },
  };
}

const fxAt = (eurPerUsd: number | null) =>
  createFxRateService({
    async latestOnOrBefore() {
      return eurPerUsd === null
        ? null
        : { eurPerUsd, rateDate: "2026-08-21", source: "ecb" };
    },
  });

function harness(
  over: {
    transport?: ModelTransport;
    budgets?: BudgetSource;
    fxRate?: number | null;
    sink?: (line: string) => void;
  } = {},
) {
  const { ledger, rows, increments } = recordingLedger();
  const transport = over.transport ?? transportReturning("Guten Tag! Wie geht es dir?");
  const gateway = createModelGateway({
    registry: createModelRegistry(),
    transport,
    ledger,
    budgets: over.budgets ?? budgetsAt({}),
    fx: fxAt(over.fxRate === undefined ? 0.92 : over.fxRate),
    logger: createLogger({ sink: over.sink ?? (() => {}) }),
    now: () => NOW,
  });
  return { gateway, rows, increments, transport };
}

function researchSpec() {
  const spec = callSpecFor("productops.market_research", {
    timeoutMs: 30_000,
    outputSchema: z.array(z.unknown()),
  });
  if (!spec.ok) throw new Error("fixture spec did not build");
  return spec.data;
}

function turnSpec() {
  const spec = callSpecFor("conversation.turn", { level: "A1", timeoutMs: 5_000 });
  if (!spec.ok) throw new Error("fixture spec did not build");
  return spec.data;
}

let spec = turnSpec();
beforeEach(() => {
  spec = turnSpec();
});

describe("a successful call", () => {
  it("returns the model's reply", async () => {
    const { gateway } = harness();

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.text).toBe("Guten Tag! Wie geht es dir?");
    expect(outcome.data.truncated).toBe(false);
    expect(outcome.data.degraded).toBe(false);
  });

  it("writes exactly one ledger row", async () => {
    const { gateway, rows } = harness();

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task: "conversation.turn",
      tier: "strong",
      status: "ok",
      attemptNumber: 1,
      maxOutputTokens: 300,
      modelIdResolved: "vendor/model-2026-01",
    });
  });

  it("converts the provider's dollars at the stored rate", async () => {
    const { gateway, rows } = harness();

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(rows[0].costUsd).toBeCloseTo(0.002, 10);
    expect(rows[0].fxRateEurPerUsd).toBe(0.92);
    expect(rows[0].costEur).toBeCloseTo(0.00184, 10);
  });

  it("always sends the provider an output ceiling", async () => {
    const { gateway, transport } = harness();

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(sentRequests(transport)[0].maxOutputTokens).toBe(300);
  });

  it("increments the daily and monthly counters alongside the row", async () => {
    const { gateway, increments } = harness();

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(increments[0].map((increment) => increment.scope).sort()).toEqual([
      "global_daily",
      "per_user_daily",
      "per_user_monthly",
    ]);
    for (const increment of increments[0]) {
      expect(increment.amountEur).toBeCloseTo(0.00184, 10);
    }
  });

  it("counts the spend against the turn's own accumulator", async () => {
    const { gateway } = harness();
    const turn = createTurnBudget(0.05);

    await gateway.complete(spec, PROMPT, { ...CONTEXT, turn });

    expect(turn.spentEur()).toBeCloseTo(0.00184, 10);
  });
});

describe("what never reaches the ledger", () => {
  it("writes no field carrying what the learner or the model said", async () => {
    const { gateway, rows } = harness();

    await gateway.complete(spec, PROMPT, CONTEXT);

    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain("Guten Tag");
    expect(serialised).not.toContain("Deutschlehrerin");
  });
});

describe("layer 1 — the input ceiling", () => {
  it("denies a prompt over the ceiling without calling the provider", async () => {
    const { gateway, rows, transport } = harness();

    const outcome = await gateway.complete(
      spec,
      { ...PROMPT, inputTokens: 4001 },
      CONTEXT,
    );

    expect(outcome).toMatchObject({ ok: false, failure: "ceiling_denied" });
    expect(sentRequests(transport)).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ceiling_denied", costUsd: 0, costEur: 0 });
  });
});

describe("layer 4 — the budget gate", () => {
  it("denies at one hundred percent and makes no provider request", async () => {
    const { gateway, rows, transport } = harness({
      budgets: budgetsAt({ "hash-alice": 1 }),
    });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "budget_denied" });
    expect(sentRequests(transport)).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "budget_denied",
      budgetScopeHit: "per_user_daily",
      costUsd: 0,
    });
  });

  it("gives the learner nothing to persist, so a denial cannot corrupt a thread", async () => {
    const { gateway } = harness({ budgets: budgetsAt({ "hash-alice": 1 }) });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(false);
    expect(outcome).not.toHaveProperty("data");
  });

  it("leaves another learner unaffected by one learner's exhaustion", async () => {
    const { gateway } = harness({ budgets: budgetsAt({ "hash-alice": 1 }) });

    const denied = await gateway.complete(spec, PROMPT, CONTEXT);
    const allowed = await gateway.complete(spec, PROMPT, {
      ...CONTEXT,
      userIdHash: "hash-bob",
    });

    expect(denied.ok).toBe(false);
    expect(allowed.ok).toBe(true);
  });

  it("fails closed when the counters cannot be read", async () => {
    const { gateway, rows } = harness({
      budgets: { async snapshot() { return null; } },
    });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "budget_denied" });
    expect(rows[0].status).toBe("budget_denied");
  });

  it("degrades at ninety percent, downgrades the tier and says so", async () => {
    const lines: string[] = [];
    const { gateway, rows } = harness({
      budgets: budgetsAt({ "hash-alice": 0.9 }),
      sink: (line) => lines.push(line),
    });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.degraded).toBe(true);
    expect(outcome.data.tier).toBe("mid");
    expect(rows[0]).toMatchObject({
      tier: "mid",
      degraded: true,
      budgetScopeHit: "per_user_daily",
    });
    expect(lines.join("\n")).toContain("budget.degraded");
  });

  it("warns at seventy percent without changing the call", async () => {
    const lines: string[] = [];
    const { gateway, rows } = harness({
      budgets: budgetsAt({ "hash-alice": 0.7 }),
      sink: (line) => lines.push(line),
    });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome.ok && outcome.data.tier).toBe("strong");
    expect(rows[0].degraded).toBe(false);
    expect(lines.join("\n")).toContain("budget.warning");
  });

  it("treats a denial as a security audit event, because cost abuse is an attack", async () => {
    const lines: string[] = [];
    const { gateway } = harness({
      budgets: budgetsAt({ "hash-alice": 1 }),
      sink: (line) => lines.push(line),
    });

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(lines.join("\n")).toContain("budget.denied");
    expect(lines.join("\n")).toContain("hash-alice");
  });

  it("refuses a call the turn accumulator has no room for", async () => {
    const { gateway, rows, transport } = harness();
    const turn = createTurnBudget(0.0001);
    turn.record(0.0001);

    const outcome = await gateway.complete(spec, PROMPT, { ...CONTEXT, turn });

    expect(outcome).toMatchObject({ ok: false, failure: "budget_denied" });
    expect(rows[0].budgetScopeHit).toBe("per_request");
    expect(sentRequests(transport)).toHaveLength(0);
  });

  it("names the scope that refused, so a caller can tell an allowance from an outage", async () => {
    // A learner who spent their own allowance can be told so and shown a plan
    // with a larger one; a learner refused because the counters could not be
    // read, or because the whole product hit its daily ceiling, must not be.
    const { gateway } = harness({ budgets: budgetsAt({ "hash-alice": 1 }) });
    const global = harness({ budgets: budgetsAt({ global: 100 }) }).gateway;
    const unreadable = harness({ budgets: { async snapshot() { return null; } } }).gateway;
    const turn = createTurnBudget(0.0001);
    turn.record(0.0001);

    expect(await gateway.complete(spec, PROMPT, CONTEXT)).toMatchObject({
      failure: "budget_denied",
      budgetScope: "per_user_daily",
    });
    expect(await global.stream(spec, PROMPT, CONTEXT)).toMatchObject({
      failure: "budget_denied",
      budgetScope: "global_daily",
    });
    expect(await unreadable.complete(spec, PROMPT, CONTEXT)).toMatchObject({
      failure: "budget_denied",
      budgetScope: null,
    });
    expect(await harness().gateway.complete(spec, PROMPT, { ...CONTEXT, turn })).toMatchObject({
      failure: "budget_denied",
      budgetScope: "per_request",
    });
  });

  it("names no scope on a refusal that was not about money", async () => {
    const { gateway } = harness();

    const outcome = await gateway.complete(spec, { ...PROMPT, inputTokens: 100_000 }, CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "ceiling_denied" });
    expect(outcome).not.toHaveProperty("budgetScope");
  });
});

describe("a plan", () => {
  function freeTurnSpec() {
    const built = callSpecFor("conversation.turn", { level: "A1", plan: "free", timeoutMs: 5_000 });
    if (!built.ok) throw new Error("fixture spec did not build");
    return built.data;
  }

  /** A budget source that remembers what it was asked, and spends nothing. */
  function askedBudgets() {
    const asked: Array<Parameters<BudgetSource["snapshot"]>[0]> = [];
    const budgets: BudgetSource = {
      async snapshot(input) {
        asked.push(input);
        return [];
      },
    };
    return { budgets, asked };
  }

  it("runs a free learner's turn on the plan's tier", async () => {
    const { gateway, rows, transport } = harness();

    const outcome = await gateway.complete(freeTurnSpec(), PROMPT, { ...CONTEXT, plan: "free" });

    expect(outcome.ok && outcome.data.tier).toBe("mid");
    expect(rows[0]).toMatchObject({ tier: "mid", degraded: false });
    expect(sentRequests(transport)[0]?.modelId).toBe(createModelRegistry().forTier("mid").modelId);
  });

  it("degrades from the plan's tier, not the table's: a free turn under pressure runs on cheap", async () => {
    // billing-and-plans-spec.md S3: one rung down from where the plan put it.
    const { gateway, rows } = harness({ budgets: budgetsAt({ "hash-alice": 0.9 }) });

    const outcome = await gateway.complete(freeTurnSpec(), PROMPT, { ...CONTEXT, plan: "free" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data).toMatchObject({ tier: "cheap", degraded: true });
    expect(rows[0]).toMatchObject({ tier: "cheap", degraded: true, maxOutputTokens: 150 });
  });

  it("degrades a streamed free turn the same way", async () => {
    const { gateway } = harness({ budgets: budgetsAt({ "hash-alice": 0.9 }) });

    const opened = await gateway.stream(freeTurnSpec(), PROMPT, { ...CONTEXT, plan: "free" });

    expect(opened.ok && opened.data).toMatchObject({ tier: "cheap", degraded: true });
  });

  it("hands the budget source the learner's plan, so the plan's euro bound applies", async () => {
    const { budgets, asked } = askedBudgets();
    const { gateway } = harness({ budgets });

    // A plan-invariant task still spends from the plan's budget.
    await gateway.complete(spec, PROMPT, { ...CONTEXT, plan: "plus" });

    expect(asked).toEqual([{ userIdHash: "hash-alice", now: NOW, plan: "plus" }]);
  });

  it("budgets by the spec's plan when the context names none", async () => {
    const { budgets, asked } = askedBudgets();
    const { gateway } = harness({ budgets });

    await gateway.complete(freeTurnSpec(), PROMPT, CONTEXT);

    expect(asked[0]?.plan).toBe("free");
  });

  it("asks for no plan when neither the spec nor the context has one", async () => {
    const { budgets, asked } = askedBudgets();
    const { gateway } = harness({ budgets });

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(asked).toEqual([{ userIdHash: "hash-alice", now: NOW }]);
  });

  it("refuses a spec routed for one plan and budgeted as another", async () => {
    // A free spec on premium's budget is a bug in the caller, and a free
    // learner spending premium's allowance is what it would cost.
    const { gateway, rows, transport } = harness();

    const outcome = await gateway.complete(freeTurnSpec(), PROMPT, { ...CONTEXT, plan: "premium" });

    expect(outcome).toMatchObject({ ok: false, failure: "invalid_spec" });
    expect(sentRequests(transport)).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it("refuses a free spec that has been edited onto the paid tier", async () => {
    const { gateway, transport } = harness();

    const outcome = await gateway.complete(
      { ...freeTurnSpec(), tier: "strong" },
      PROMPT,
      { ...CONTEXT, plan: "free" },
    );

    expect(outcome).toMatchObject({ ok: false, failure: "invalid_spec" });
    expect(sentRequests(transport)).toHaveLength(0);
  });
});

describe("failures", () => {
  it("writes a row for a provider error and tries the fallback", async () => {
    const requests: ModelRequest[] = [];
    const transport: ModelTransport = {
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) throw new Error("upstream 502");
        return { text: "Alles gut.", usage: usage(), firstTokenMs: 100 };
      },
      async stream() {
        throw new Error("not used");
      },
    };
    const { gateway, rows } = harness({ transport });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "error", attemptNumber: 1 });
    expect(rows[1]).toMatchObject({ status: "ok", attemptNumber: 2 });
    expect(rows[0].modelId).not.toBe(rows[1].modelId);
  });

  it("never puts a provider's message into the ledger's error code", async () => {
    const transport: ModelTransport = {
      async complete() {
        throw new Error("upstream said: Guten Tag! is unsafe");
      },
      async stream() {
        throw new Error("not used");
      },
    };
    const { gateway, rows } = harness({ transport });

    await gateway.complete(spec, PROMPT, CONTEXT);

    for (const row of rows) {
      expect(row.errorCode ?? "").not.toContain("Guten Tag");
      expect((row.errorCode ?? "").length).toBeLessThanOrEqual(64);
    }
  });

  it("gives up once every candidate has failed", async () => {
    const transport: ModelTransport = {
      async complete() {
        throw new Error("upstream 502");
      },
      async stream() {
        throw new Error("not used");
      },
    };
    const { gateway, rows } = harness({ transport });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "provider_error" });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.status === "error")).toBe(true);
    expect(new Set(rows.map((row) => row.attemptNumber)).size).toBe(rows.length);
  });

  it("records a timeout as a timeout, not as an error", async () => {
    const transport: ModelTransport = {
      complete(request) {
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      },
      async stream() {
        throw new Error("not used");
      },
    };
    const fast = callSpecFor("conversation.turn", { level: "A1", timeoutMs: 20 });
    if (!fast.ok) throw new Error("fixture spec did not build");
    const { gateway, rows } = harness({ transport });

    const outcome = await gateway.complete(fast.data, PROMPT, CONTEXT);

    expect(outcome).toMatchObject({ ok: false, failure: "timeout" });
    expect(rows.every((row) => row.status === "timeout")).toBe(true);
  });
});

describe("pricing when the provider does not report cost", () => {
  it("estimates from the cached snapshot", async () => {
    const { ledger, rows } = recordingLedger();
    const gateway = createModelGateway({
      registry: createModelRegistry(),
      transport: transportReturning("Hallo.", { costUsd: null }),
      ledger,
      budgets: budgetsAt({}),
      fx: fxAt(0.5),
      pricing: {
        async latestFor(provider, modelId) {
          return {
            provider,
            modelId,
            inputRate: 0.000001,
            outputRate: 0.000002,
            currency: "USD",
            fetchedAt: NOW,
          };
        },
      },
      logger: createLogger({ sink: () => {} }),
      now: () => NOW,
    });

    await gateway.complete(spec, PROMPT, CONTEXT);

    // 900 input + 120 output against the snapshot above.
    expect(rows[0].costUsd).toBeCloseTo(0.00114, 10);
    expect(rows[0].costEur).toBeCloseTo(0.00057, 10);
  });

  it("records zero dollars when neither the provider nor a snapshot can price it", async () => {
    const { gateway, rows } = harness({
      transport: transportReturning("Hallo.", { costUsd: null }),
    });

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(rows[0].costUsd).toBe(0);
  });
});

describe("euro conversion", () => {
  it("flags a row it could not price in euro", async () => {
    const { gateway, rows } = harness({ fxRate: null });

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(rows[0]).toMatchObject({ fxRateEurPerUsd: null, fxStale: true, costEur: 0 });
    expect(rows[0].costUsd).toBeCloseTo(0.002, 10);
  });
});

describe("layer 3 — the stream guard", () => {
  it("aborts an overrunning stream and flags the row truncated", async () => {
    const transport: ModelTransport = {
      async complete() {
        throw new Error("not used");
      },
      async stream() {
        async function* chunks() {
          for (let index = 0; index < 400; index += 1) yield "Wort für Wort. ";
        }
        return { chunks: chunks(), usage: () => usage(), firstTokenMs: () => 150 };
      },
    };
    const { gateway, rows } = harness({ transport });

    const outcome = await gateway.stream(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const collected: string[] = [];
    for await (const chunk of outcome.data.chunks) collected.push(chunk);
    const settled = await outcome.data.settled;

    expect(settled.truncated).toBe(true);
    expect(collected.join("")).toContain("Wort für Wort.");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ truncated: true, status: "ok" });
    expect(rows[0].outputTokens).toBeLessThanOrEqual(300);
  });

  it("keeps a stream inside the ceiling unflagged", async () => {
    const { gateway, rows } = harness();

    const outcome = await gateway.stream(spec, PROMPT, CONTEXT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    for await (const _chunk of outcome.data.chunks) void _chunk;
    await outcome.data.settled;

    expect(rows[0].truncated).toBe(false);
  });
});

describe("a stream whose model will not open", () => {
  /** Opens on the nth attempt and refuses every attempt before it. */
  function opensOnAttempt(n: number) {
    const requests: ModelRequest[] = [];
    const transport: ModelTransport = {
      requests,
      async complete() {
        throw new Error("not used");
      },
      async stream(request) {
        requests.push(request);
        if (requests.length < n) throw new Error("404 no endpoints available");
        async function* chunks() {
          yield "Alles gut.";
        }
        return { chunks: chunks(), usage: () => usage(), firstTokenMs: () => 120 };
      },
    } as ModelTransport & { requests: ModelRequest[] };
    return { transport, requests };
  }

  it("falls back to the next model, the way a completion already does", async () => {
    // A tier's primary being unreachable — retired, rate-limited, or refused
    // by the account's own data policy — is what its fallback is for. This
    // path used to try one model and give up, so one unavailable model took
    // down every conversation while the non-streaming path recovered.
    const { transport, requests } = opensOnAttempt(2);
    const { gateway, rows } = harness({ transport });

    const outcome = await gateway.stream(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const collected: string[] = [];
    for await (const chunk of outcome.data.chunks) collected.push(chunk);
    await outcome.data.settled;

    expect(collected.join("")).toBe("Alles gut.");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.modelId).not.toBe(requests[1]?.modelId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "error", attemptNumber: 1 });
    expect(rows[1]).toMatchObject({ status: "ok", attemptNumber: 2 });
  });

  it("writes a row for the attempt that never opened", async () => {
    // A refused call may still have been billed, and a run of them is the
    // shape an operator needs to see.
    const { transport } = opensOnAttempt(2);
    const { gateway, rows } = harness({ transport });

    await gateway.stream(spec, PROMPT, CONTEXT);

    expect(rows[0]).toMatchObject({ status: "error", outputTokens: 0 });
    expect(rows[0]?.errorCode).not.toMatch(/404|endpoints/);
  });

  it("gives up once every candidate has refused", async () => {
    const { transport, requests } = opensOnAttempt(99);
    const { gateway, rows } = harness({ transport });

    const outcome = await gateway.stream(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(false);
    expect(requests.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.status === "error")).toBe(true);
  });

  it("does not start a second model once the learner is reading the first", async () => {
    // After the first byte a fallback would be continuing somebody else's
    // sentence, so a stream that breaks mid-flight stays broken.
    const requests: ModelRequest[] = [];
    const transport: ModelTransport = {
      async complete() {
        throw new Error("not used");
      },
      async stream(request) {
        requests.push(request);
        async function* chunks() {
          yield "Alles ";
          throw new Error("connection reset");
        }
        return { chunks: chunks(), usage: () => usage(), firstTokenMs: () => 120 };
      },
    };
    const { gateway } = harness({ transport });

    const outcome = await gateway.stream(spec, PROMPT, CONTEXT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const collected: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of outcome.data.chunks) collected.push(chunk);
      })(),
    ).rejects.toThrow();

    expect(collected.join("")).toBe("Alles ");
    expect(requests).toHaveLength(1);
  });

  it("reports the refusal without repeating what the provider said", async () => {
    const transport: ModelTransport = {
      async complete() {
        throw new Error("not used");
      },
      async stream() {
        throw new Error("Guten Tag! is unsafe, says the provider");
      },
    };
    const { gateway } = harness({ transport });

    const outcome = await gateway.stream(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).not.toContain("Guten Tag");
  });
});

describe("an invalid spec", () => {
  it("is refused before anything is attempted or accounted", async () => {
    const { gateway, rows, transport } = harness();

    const outcome = await gateway.complete(
      { ...spec, maxOutputTokens: 99_999 },
      PROMPT,
      CONTEXT,
    );

    expect(outcome).toMatchObject({ ok: false, failure: "invalid_spec" });
    expect(sentRequests(transport)).toHaveLength(0);
    // Nothing was dispatched and nothing cost money, so there is nothing to
    // account for. This is a programming error, not a call.
    expect(rows).toHaveLength(0);
  });
});

describe("a ledger that is itself down", () => {
  it("does not take the learner's turn down with it", async () => {
    const lines: string[] = [];
    const gateway = createModelGateway({
      registry: createModelRegistry(),
      transport: transportReturning("Hallo."),
      ledger: { async record() { return { ok: false, detail: "ledger unreachable" }; } },
      budgets: budgetsAt({}),
      fx: fxAt(0.92),
      logger: createLogger({ sink: (line) => lines.push(line) }),
      now: () => NOW,
    });

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    expect(lines.join("\n")).toContain("ledger.write_failed");
  });
});

describe("prompt caching", () => {
  it("hands the transport the stable prefix for a conversation task", async () => {
    const { gateway, transport } = harness();

    await gateway.complete(
      spec,
      { ...PROMPT, systemStable: "Du bist eine Deutschlehrerin." },
      CONTEXT,
    );

    expect(sentRequests(transport)[0].systemStablePrefix).toBe(
      "Du bist eine Deutschlehrerin.",
    );
  });

  it("hands the transport nothing when the prompt promises no stable prefix", async () => {
    const { gateway, transport } = harness();

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(sentRequests(transport)[0].systemStablePrefix).toBeNull();
  });

  it("never marks a prefix for a one-shot task", async () => {
    // A summary runs once per thread compaction: a cache entry written for it
    // is never read back, so its stable prefix must not reach the transport.
    const oneShot = callSpecFor("summarization.thread", {
      timeoutMs: 5_000,
      outputSchema: z.object({ summary: z.string() }),
    });
    if (!oneShot.ok) throw new Error("fixture spec did not build");

    const { gateway, transport } = harness();

    await gateway.complete(
      oneShot.data,
      { ...PROMPT, systemStable: "Du bist eine Deutschlehrerin." },
      CONTEXT,
    );

    expect(sentRequests(transport)[0].systemStablePrefix).toBeNull();
  });
});

describe("dependencies", () => {
  it("asks the budget source about the learner making the call", async () => {
    const snapshot = vi.fn().mockResolvedValue([]);
    const { ledger } = recordingLedger();
    const gateway = createModelGateway({
      registry: createModelRegistry(),
      transport: transportReturning("Hallo."),
      ledger,
      budgets: { snapshot },
      fx: fxAt(0.92),
      logger: createLogger({ sink: () => {} }),
      now: () => NOW,
    });

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(snapshot).toHaveBeenCalledWith({ userIdHash: "hash-alice", now: NOW });
  });
});

describe("web search", () => {
  it("is taken from the routing table, not from the caller", async () => {
    // The caller hands over a spec and a prompt and never a search flag. The
    // table is the only thing that can grant a paid capability.
    const { gateway, transport } = harness();

    await gateway.complete(researchSpec(), PROMPT, CONTEXT);

    expect(sentRequests(transport)[0].webSearch).toEqual({ maxResults: 5 });
  });

  it("is absent for a task the table does not grant it to", async () => {
    const { gateway, transport } = harness();

    await gateway.complete(spec, PROMPT, CONTEXT);

    expect(sentRequests(transport)[0].webSearch).toBeNull();
  });

  it("passes the provider's citations through to the caller", async () => {
    const transport: ModelTransport & { requests: ModelRequest[] } = {
      requests: [],
      async complete(request) {
        this.requests.push(request);
        return {
          text: "[]",
          usage: usage(),
          firstTokenMs: 200,
          citations: [{ url: "https://example.test/a", title: "A" }],
        } satisfies CompletionResponse;
      },
      async stream() {
        throw new Error("not used");
      },
    };
    const { gateway } = harness({ transport });

    const outcome = await gateway.complete(researchSpec(), PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.citations).toEqual([
      { url: "https://example.test/a", title: "A" },
    ]);
  });

  it("reports an empty citation list when a transport reports none", async () => {
    // So a caller never has to tell "no citations" from "this transport does
    // not do citations".
    const { gateway } = harness();

    const outcome = await gateway.complete(spec, PROMPT, CONTEXT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.citations).toEqual([]);
  });

  it("writes no citation into the ledger", async () => {
    // A url is content. The ledger holds accounting and nothing a prompt or a
    // reply carried (guardrails S17).
    const { gateway, rows } = harness();

    await gateway.complete(researchSpec(), PROMPT, CONTEXT);

    expect(JSON.stringify(rows)).not.toContain("citation");
  });
});
