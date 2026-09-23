import { describe, expect, it } from "vitest";

import type { BudgetLimit, BudgetOverview, LearnerSpend } from "@dp/db/budget-repository";

import { budgetBoard, globalDailyLimitEur, globalMeter, learnerMeter } from "@/lib/budgets";

const HASH = "0123456789abcdef0123456789abcdef";

function limit(over: Partial<BudgetLimit>): BudgetLimit {
  return {
    id: 1,
    scope: "global_daily",
    scopeKey: null,
    limitEur: 50,
    warnPct: 0.7,
    degradePct: 0.9,
    active: true,
    updatedAt: new Date("2026-09-23T10:00:00Z"),
    ...over,
  };
}

function overview(over: Partial<BudgetOverview> = {}): BudgetOverview {
  return {
    generatedAt: new Date("2026-09-23T15:00:00Z"),
    dayStart: new Date("2026-09-23T00:00:00Z"),
    monthStart: new Date("2026-09-01T00:00:00Z"),
    limits: [],
    globalSpentEur: 0,
    learners: [],
    learnerCounts: { daily: 0, monthly: 0 },
    ...over,
  };
}

describe("the budget board", () => {
  it("lists every enforced scope, and says which have no limit at all", () => {
    const board = budgetBoard(overview({ limits: [limit({})] }));

    expect(board.scopes.map((row) => [row.scope, row.limit?.limitEur ?? null])).toEqual([
      ["global_daily", 50],
      ["per_user_daily", null],
      ["per_user_monthly", null],
    ]);
    expect(board.unlimited).toEqual(["per_user_daily", "per_user_monthly"]);
  });

  it("separates learners' overrides from the defaults", () => {
    const board = budgetBoard(
      overview({
        limits: [
          limit({ id: 2, scope: "per_user_daily", limitEur: 0.5 }),
          limit({ id: 3, scope: "per_user_daily", scopeKey: HASH, limitEur: 2 }),
        ],
      }),
    );

    expect(board.scopes[1]?.limit?.id).toBe(2);
    expect(board.overrides.map((row) => row.id)).toEqual([3]);
  });

  it("does not count an inactive default as a limit", () => {
    // Written before this page existed, perhaps; the gate ignores it all the same.
    const board = budgetBoard(overview({ limits: [limit({ active: false })] }));

    expect(board.scopes[0]?.limit).toBeNull();
    expect(board.unlimited).toContain("global_daily");
  });

  it("sets aside per_request rows, which nothing enforces", () => {
    const board = budgetBoard(overview({ limits: [limit({ id: 9, scope: "per_request", limitEur: 0.05 })] }));

    expect(board.unenforced.map((row) => row.id)).toEqual([9]);
    expect(board.overrides).toEqual([]);
  });
});

describe("the global meter", () => {
  it("reports today's spend against the limit, in the gate's own terms", () => {
    const meter = globalMeter(overview({ limits: [limit({})], globalSpentEur: 46 }));

    expect(meter).toEqual({ limitEur: 50, spentEur: 46, ratio: 0.92, state: "degrade" });
  });

  it("says unlimited rather than dividing by nothing", () => {
    expect(globalMeter(overview({ globalSpentEur: 12 }))).toEqual({
      limitEur: null,
      spentEur: 12,
      ratio: null,
      state: "unlimited",
    });
  });

  it("reads a zero limit as closed, not as unlimited", () => {
    expect(globalMeter(overview({ limits: [limit({ limitEur: 0 })] })).state).toBe("deny");
  });

  it("gives the spend page the limit it used to hardcode", () => {
    expect(globalDailyLimitEur(overview({ limits: [limit({ limitEur: 35 })] }))).toBe(35);
    expect(globalDailyLimitEur(overview())).toBeNull();
  });
});

describe("a learner's meter", () => {
  const row: LearnerSpend = {
    scope: "per_user_daily",
    userIdHash: HASH,
    spentEur: 0.4,
    limitEur: 0.5,
    warnPct: 0.7,
    degradePct: 0.9,
    overridden: false,
  };

  it("uses the thresholds that apply to that learner", () => {
    expect(learnerMeter(row)).toEqual({ limitEur: 0.5, spentEur: 0.4, ratio: 0.8, state: "warn" });
  });

  it("is unlimited when no limit applies", () => {
    expect(learnerMeter({ ...row, limitEur: null, warnPct: null, degradePct: null }).state).toBe(
      "unlimited",
    );
  });
});
