import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiters } from "@/lib/api/rate-limit";
import { BUDGET_FORM_IDLE } from "@/lib/budgets";

/**
 * The cost pages' actions: changing what the product may spend, and asking
 * the worker for fresh figures.
 *
 * Each is its own entry point, so each is tested to refuse on its own before
 * touching anything. Each change is an audit event under the operator's
 * pseudonym, carrying the before and after — the only record of who moved a
 * limit, until there is an audit table. And nothing here runs a job: it asks.
 */

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const HASH = "0123456789abcdef0123456789abcdef";
const LEARNER_HASH = "fedcba9876543210fedcba9876543210";

const currentUser = vi.fn();
const setLimit = vi.fn();
const removeOverride = vi.fn();
const enqueue = vi.fn();
const refresh = vi.fn();
const logged: Array<{ event: string; fields: Record<string, unknown> }> = [];

const record = (event: string, fields: Record<string, unknown> = {}) => {
  logged.push({ event, fields });
};
const logger = { debug: vi.fn(), info: record, warn: record, error: record };

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/require-operator", () => ({
  operatorForAction: async () => {
    const id = await currentUser();
    return id === OPERATOR ? { id, email: null, hash: HASH, aal: "aal2" } : null;
  },
}));
vi.mock("@/lib/api/composition", () => ({
  actionLogger: () => logger,
  createCostAdmin: () => ({
    budgets: { setLimit, removeOverride },
    pricing: {},
    ledger: {},
    jobs: { enqueue: (request: unknown) => enqueue(request) },
    logger,
  }),
}));

const { removeBudgetOverrideAction, saveBudgetLimitAction } = await import(
  "@/app/(ops)/costs/budgets/actions"
);
const { rebuildCostRollupAction, refreshPricingAction } = await import(
  "@/app/(ops)/costs/pricing/actions"
);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const DEFAULT_FORM = {
  scope: "global_daily",
  scopeKey: "",
  limitEur: "40",
  warnPct: "70",
  degradePct: "90",
  active: "on",
};

const stored = (over: Record<string, unknown> = {}) => ({
  id: 1,
  scope: "global_daily",
  scopeKey: null,
  limitEur: 40,
  warnPct: 0.7,
  degradePct: 0.9,
  active: true,
  updatedAt: new Date(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiters();
  logged.length = 0;
  currentUser.mockResolvedValue(OPERATOR);
  setLimit.mockResolvedValue({
    ok: true,
    data: { before: stored({ limitEur: 50 }), after: stored() },
  });
  removeOverride.mockResolvedValue({
    ok: true,
    data: stored({ scope: "per_user_daily", scopeKey: LEARNER_HASH }),
  });
  enqueue.mockResolvedValue({ ok: true, data: { id: 4, created: true, queue: "jobs" } });
});

describe("somebody who is not an operator", () => {
  beforeEach(() => {
    currentUser.mockResolvedValue(LEARNER);
  });

  it("cannot change a limit, and is told nothing more than that it was not saved", async () => {
    const state = await saveBudgetLimitAction(BUDGET_FORM_IDLE, form(DEFAULT_FORM));

    expect(state.status).toBe("error");
    expect(setLimit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cannot remove an override", async () => {
    await removeBudgetOverrideAction(form({ scope: "per_user_daily", scopeKey: LEARNER_HASH }));

    expect(removeOverride).not.toHaveBeenCalled();
  });

  it("cannot ask for a pricing snapshot or a rollup", async () => {
    await refreshPricingAction();
    await rebuildCostRollupAction(form({ sinceDays: "7" }));

    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("an operator changing a limit", () => {
  it("saves the decimal strings the form validated", async () => {
    const state = await saveBudgetLimitAction(
      BUDGET_FORM_IDLE,
      form({ ...DEFAULT_FORM, limitEur: "40,50" }),
    );

    expect(setLimit).toHaveBeenCalledWith({
      scope: "global_daily",
      scopeKey: null,
      limitEur: "40.50",
      warnPct: "0.70",
      degradePct: "0.90",
      active: true,
    });
    expect(state.status).toBe("saved");
    expect(refresh).toHaveBeenCalled();
  });

  it("records who moved it, from what, to what", async () => {
    await saveBudgetLimitAction(BUDGET_FORM_IDLE, form(DEFAULT_FORM));

    const audit = logged.find((line) => line.event === "budget.limit_changed");
    expect(audit?.fields).toMatchObject({
      audit: true,
      userIdHash: HASH,
      scope: "global_daily",
      before: { limitEur: 50, warnPct: 0.7, degradePct: 0.9, active: true },
      after: { limitEur: 40, warnPct: 0.7, degradePct: 0.9, active: true },
    });
    expect(JSON.stringify(logged)).not.toContain(OPERATOR);
  });

  it("reads an unticked box as a paused override", async () => {
    await saveBudgetLimitAction(
      BUDGET_FORM_IDLE,
      form({ scope: "per_user_daily", scopeKey: LEARNER_HASH, limitEur: "2", warnPct: "70", degradePct: "90" }),
    );

    expect(setLimit).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: LEARNER_HASH, active: false }));
  });

  it("explains a refusal in the form's own words, and writes nothing", async () => {
    const state = await saveBudgetLimitAction(
      BUDGET_FORM_IDLE,
      form({ ...DEFAULT_FORM, warnPct: "95", degradePct: "90" }),
    );

    expect(state).toEqual({ status: "error", message: "warn must come before degrade" });
    expect(setLimit).not.toHaveBeenCalled();
  });

  it("refuses an email where a learner's pseudonym belongs", async () => {
    const state = await saveBudgetLimitAction(
      BUDGET_FORM_IDLE,
      form({ ...DEFAULT_FORM, scope: "per_user_daily", scopeKey: "alice@example.com" }),
    );

    expect(state.status).toBe("error");
    expect(setLimit).not.toHaveBeenCalled();
  });

  it("does not claim a save the database refused", async () => {
    setLimit.mockResolvedValue({ ok: false, error: { kind: "invalid_input", message: "x" } });

    const state = await saveBudgetLimitAction(BUDGET_FORM_IDLE, form(DEFAULT_FORM));

    expect(state.status).toBe("error");
    expect(logged.find((line) => line.event === "budget.limit_changed")).toBeUndefined();
  });

  it("is rate limited", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await saveBudgetLimitAction(BUDGET_FORM_IDLE, form(DEFAULT_FORM));
    }
    setLimit.mockClear();

    const state = await saveBudgetLimitAction(BUDGET_FORM_IDLE, form(DEFAULT_FORM));

    expect(state.status).toBe("error");
    expect(setLimit).not.toHaveBeenCalled();
  });
});

describe("an operator removing an override", () => {
  it("removes it and records what it was", async () => {
    await removeBudgetOverrideAction(form({ scope: "per_user_daily", scopeKey: LEARNER_HASH }));

    expect(removeOverride).toHaveBeenCalledWith({ scope: "per_user_daily", scopeKey: LEARNER_HASH });
    expect(logged.find((line) => line.event === "budget.override_removed")?.fields).toMatchObject({
      audit: true,
      userIdHash: HASH,
      scopeKey: LEARNER_HASH,
      before: { limitEur: 40 },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("never sends a default's blank key", async () => {
    await removeBudgetOverrideAction(form({ scope: "per_user_daily", scopeKey: "" }));

    expect(removeOverride).not.toHaveBeenCalled();
  });
});

describe("an operator asking for fresh figures", () => {
  it("queues a pricing snapshot for the worker", async () => {
    await refreshPricingAction();

    expect(enqueue).toHaveBeenCalledWith({
      payload: {
        kind: "pricing.snapshot",
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        source: "ops",
      },
      requestedByHash: HASH,
    });
    expect(logged.find((line) => line.event === "pricing.snapshot_requested")?.fields).toMatchObject({
      audit: true,
      queued: true,
    });
  });

  it("queues a rollup rebuild over the days asked for", async () => {
    await rebuildCostRollupAction(form({ sinceDays: "14" }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ kind: "cost.rollup", sinceDays: 14, source: "ops" }),
      }),
    );
  });

  it("refuses a rollup window the job would refuse", async () => {
    await rebuildCostRollupAction(form({ sinceDays: "0" }));
    await rebuildCostRollupAction(form({ sinceDays: "a week" }));

    expect(enqueue).not.toHaveBeenCalled();
  });
});
