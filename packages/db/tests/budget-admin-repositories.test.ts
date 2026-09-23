import { describe, expect, it } from "vitest";

import { createBudgetRepository } from "../src/budget-repository";
import { LEDGER_PAGE_SIZE, createLedgerRepository } from "../src/ledger-repository";
import { createPricingRepository } from "../src/pricing-repository";
import { createFakeSupabase } from "@dp/test-support/fake-supabase";

const HASH = "0123456789abcdef0123456789abcdef";
const REQUEST = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const limitRow = {
  id: 3,
  scope: "per_user_daily",
  scope_key: null,
  limit_eur: "0.5000",
  warn_pct: "0.700",
  degrade_pct: "0.900",
  active: true,
  created_at: "2026-09-20T10:00:00+00:00",
  updated_at: "2026-09-23T10:00:00+00:00",
};

describe("the budget repository", () => {
  it("reads the overview the database assembled, numbers and all", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: {
        generatedAt: "2026-09-23T15:00:00+00:00",
        dayStart: "2026-09-23T00:00:00+00:00",
        monthStart: "2026-09-01T00:00:00+00:00",
        limits: [
          {
            id: 3,
            scope: "per_user_daily",
            scopeKey: null,
            limitEur: "0.5000",
            warnPct: "0.700",
            degradePct: "0.900",
            active: true,
            updatedAt: "2026-09-23T10:00:00+00:00",
          },
        ],
        globalSpentEur: "12.500000",
        learners: [
          {
            scope: "per_user_daily",
            userIdHash: HASH,
            spentEur: "0.400000",
            limitEur: "0.5000",
            warnPct: "0.700",
            degradePct: "0.900",
            overridden: false,
          },
        ],
        learnerCounts: { daily: 1, monthly: 0 },
      },
    });

    const result = await createBudgetRepository(fake.client).overview(new Date("2026-09-23T15:00:00Z"));

    expect(fake.rpcCalls[0]).toEqual({
      fn: "budget_overview",
      args: { p_now: "2026-09-23T15:00:00.000Z", p_top: 20 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.globalSpentEur).toBe(12.5);
    expect(result.data.limits[0]?.limitEur).toBe(0.5);
    expect(result.data.learners[0]).toMatchObject({ userIdHash: HASH, spentEur: 0.4, limitEur: 0.5 });
  });

  it("reports an unlimited learner as unlimited rather than as zero", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: {
        generatedAt: "2026-09-23T15:00:00+00:00",
        dayStart: "2026-09-23T00:00:00+00:00",
        monthStart: "2026-09-01T00:00:00+00:00",
        limits: [],
        globalSpentEur: 0,
        learners: [
          {
            scope: "per_user_monthly",
            userIdHash: HASH,
            spentEur: "4",
            limitEur: null,
            warnPct: null,
            degradePct: null,
            overridden: false,
          },
        ],
        learnerCounts: { daily: 0, monthly: 1 },
      },
    });

    const result = await createBudgetRepository(fake.client).overview(new Date());

    expect(result.ok && result.data.learners[0]?.limitEur).toBeNull();
  });

  it("sends a limit as the decimal strings it was validated as", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: { before: null, after: limitRow } });

    const result = await createBudgetRepository(fake.client).setLimit({
      scope: "per_user_daily",
      scopeKey: null,
      limitEur: "0.50",
      warnPct: "0.70",
      degradePct: "0.90",
      active: true,
    });

    expect(fake.rpcCalls[0]).toEqual({
      fn: "set_budget_limit",
      args: {
        p_scope: "per_user_daily",
        p_scope_key: null,
        p_limit_eur: "0.50",
        p_warn_pct: "0.70",
        p_degrade_pct: "0.90",
        p_active: true,
      },
    });
    expect(result.ok && result.data.after).toMatchObject({ scope: "per_user_daily", limitEur: 0.5 });
    expect(result.ok && result.data.before).toBeNull();
  });

  it("refuses an invalid limit before any query is issued", async () => {
    const fake = createFakeSupabase({});

    const result = await createBudgetRepository(fake.client).setLimit({
      scope: "per_request",
      scopeKey: null,
      limitEur: "0.05",
      warnPct: "0.70",
      degradePct: "0.90",
      active: true,
    } as never);

    expect(result.ok).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("maps the database's refusal to a safe kind", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ error: { code: "22023", message: "the global scope takes no key" } });

    const result = await createBudgetRepository(fake.client).setLimit({
      scope: "global_daily",
      scopeKey: null,
      limitEur: "50",
      warnPct: "0.70",
      degradePct: "0.90",
      active: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Never the database's own words: they are for the log, not the page.
    expect(result.error.message).not.toContain("global scope");
  });

  it("removes only an override keyed by a pseudonym", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: { ...limitRow, scope_key: HASH } });
    const budgets = createBudgetRepository(fake.client);

    const removed = await budgets.removeOverride({ scope: "per_user_daily", scopeKey: HASH });
    expect(removed.ok && removed.data?.scopeKey).toBe(HASH);

    const refused = await budgets.removeOverride({ scope: "global_daily", scopeKey: HASH } as never);
    expect(refused.ok).toBe(false);
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it("says so when there was no override to remove", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: null });

    const result = await createBudgetRepository(fake.client).removeOverride({
      scope: "per_user_daily",
      scopeKey: HASH,
    });

    expect(result).toEqual({ ok: true, data: null });
  });
});

describe("the pricing repository", () => {
  it("reads the newest price per model and the recent rates", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: {
        models: [
          {
            provider: "openrouter",
            modelId: "vendor/a",
            currency: "USD",
            inputUsdPerToken: "0.000003000000",
            outputUsdPerToken: "0.000004000000",
            fetchedAt: "2026-09-22T04:13:00+00:00",
            snapshots: 3,
            previous: {
              inputUsdPerToken: "0.000001000000",
              outputUsdPerToken: "0.000002000000",
              fetchedAt: "2026-09-20T04:13:00+00:00",
            },
          },
        ],
        fx: [{ rate: "0.92000000", rateDate: "2026-09-22", source: "ecb", fetchedAt: "2026-09-22T07:07:00+00:00" }],
        lastFetchedAt: "2026-09-22T04:13:00+00:00",
      },
    });

    const result = await createPricingRepository(fake.client).overview();

    expect(fake.rpcCalls[0]).toEqual({ fn: "pricing_overview", args: { p_fx_days: 30 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.models[0]?.inputUsdPerToken).toBe(0.000003);
    expect(result.data.models[0]?.previous?.fetchedAt).toBeInstanceOf(Date);
    expect(result.data.fx[0]).toMatchObject({ rateDate: "2026-09-22", source: "ecb" });
  });

  it("reads an empty table as empty lists and no fetch", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: { models: [], fx: [], lastFetchedAt: null } });

    const result = await createPricingRepository(fake.client).overview();

    expect(result).toEqual({ ok: true, data: { models: [], fx: [], lastFetchedAt: null } });
  });
});

const ledgerRow = {
  id: 912,
  created_at: "2026-09-23T14:59:00+00:00",
  request_id: REQUEST,
  trace_id: "trace-1",
  user_id_hash: HASH,
  thread_id: null,
  message_id: null,
  task: "conversation.turn",
  tier: "strong",
  prompt_name: "trainer.turn",
  prompt_version: 12,
  provider: "openrouter",
  model_id: "vendor/requested",
  model_id_resolved: "vendor/resolved",
  input_tokens: 1800,
  output_tokens: 240,
  reasoning_tokens: null,
  cached_input_tokens: 900,
  max_output_tokens: 700,
  truncated: false,
  escalated: false,
  degraded: false,
  budget_scope_hit: null,
  attempt_number: 1,
  latency_ms: 1200,
  first_token_ms: 300,
  status: "ok",
  error_code: null,
  cost_usd: "0.00241000",
  fx_rate_eur_per_usd: "0.92000000",
  fx_stale: false,
  cost_eur: "0.00221720",
};

describe("the ledger repository", () => {
  it("lists a bounded window, newest first, with every filter applied", async () => {
    const fake = createFakeSupabase({ model_invocations: { data: [ledgerRow] } });

    const result = await createLedgerRepository(fake.client).list({
      from: new Date("2026-09-16T00:00:00Z"),
      to: new Date("2026-09-23T15:00:00Z"),
      status: "budget_denied",
      task: "conversation.turn",
      modelIdResolved: "vendor/resolved",
      userIdHash: HASH,
      requestId: REQUEST,
      truncated: true,
      degraded: true,
      escalated: true,
      fxStale: true,
      before: 1000,
    });

    const eqs = fake.methodArgs("model_invocations", "eq");
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["status", "budget_denied"],
        ["task", "conversation.turn"],
        ["model_id_resolved", "vendor/resolved"],
        ["user_id_hash", HASH],
        ["request_id", REQUEST],
        ["truncated", true],
        ["degraded", true],
        ["escalated", true],
        ["fx_stale", true],
      ]),
    );
    expect(fake.methodArgs("model_invocations", "gte")).toEqual([["created_at", "2026-09-16T00:00:00.000Z"]]);
    expect(fake.methodArgs("model_invocations", "lt")).toEqual(
      expect.arrayContaining([["created_at", "2026-09-23T15:00:00.000Z"], ["id", 1000]]),
    );
    expect(fake.methodArgs("model_invocations", "order")).toEqual([["id", { ascending: false }]]);
    // One more than a page, to know whether there is another.
    expect(fake.methodArgs("model_invocations", "limit")).toEqual([[LEDGER_PAGE_SIZE + 1]]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows[0]).toMatchObject({ id: 912, costEur: 0.0022172, modelIdResolved: "vendor/resolved" });
    expect(result.data.nextBefore).toBeNull();
  });

  it("applies no filter that was not asked for", async () => {
    const fake = createFakeSupabase({ model_invocations: { data: [] } });

    await createLedgerRepository(fake.client).list({
      from: new Date("2026-09-16T00:00:00Z"),
      to: new Date("2026-09-23T15:00:00Z"),
    });

    expect(fake.methodArgs("model_invocations", "eq")).toEqual([]);
  });

  it("hands back a cursor when there is another page", async () => {
    const rows = Array.from({ length: LEDGER_PAGE_SIZE + 1 }, (_, index) => ({
      ...ledgerRow,
      id: 500 - index,
    }));
    const fake = createFakeSupabase({ model_invocations: { data: rows } });

    const result = await createLedgerRepository(fake.client).list({
      from: new Date("2026-09-16T00:00:00Z"),
      to: new Date("2026-09-23T15:00:00Z"),
    });

    expect(result.ok && result.data.rows).toHaveLength(LEDGER_PAGE_SIZE);
    expect(result.ok && result.data.nextBefore).toBe(500 - (LEDGER_PAGE_SIZE - 1));
  });

  it("refuses a window longer than the ledger may be scanned over", async () => {
    const fake = createFakeSupabase({ model_invocations: { data: [] } });

    const result = await createLedgerRepository(fake.client).list({
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-09-23T00:00:00Z"),
    });

    expect(result.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("reads one call with every attempt that shared its request", async () => {
    const retry = { ...ledgerRow, id: 913, attempt_number: 2 };
    const fake = createFakeSupabase({ model_invocations: { data: [ledgerRow, retry] } });

    const result = await createLedgerRepository(fake.client).get(912);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.call.id).toBe(912);
    expect(result.data.request.map((row) => row.id)).toEqual([912, 913]);
    expect(fake.methodArgs("model_invocations", "eq")).toEqual([["request_id", REQUEST]]);
  });

  it("reports a call that is not there as not found", async () => {
    const fake = createFakeSupabase({ model_invocations: { data: null } });

    const result = await createLedgerRepository(fake.client).get(4);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not_found");
  });
});
