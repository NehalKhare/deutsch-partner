import { describe, expect, it } from "vitest";

import {
  BUDGET_SCOPES,
  evaluateBudgets,
  periodFor,
  type BudgetSnapshot,
} from "@/lib/ai/gateway/budget-gate";

const snapshot = (over: Partial<BudgetSnapshot> = {}): BudgetSnapshot => ({
  scope: "global_daily",
  scopeKey: null,
  limitEur: 10,
  spentEur: 0,
  warnPct: 0.7,
  degradePct: 0.9,
  ...over,
});

describe("budget gate", () => {
  it("allows a call well inside the limit", () => {
    expect(evaluateBudgets([snapshot({ spentEur: 1 })])).toMatchObject({
      state: "allow",
    });
  });

  it("warns at seventy percent", () => {
    expect(evaluateBudgets([snapshot({ spentEur: 7 })])).toMatchObject({
      state: "warn",
      scope: "global_daily",
    });
  });

  it("degrades at ninety percent", () => {
    expect(evaluateBudgets([snapshot({ spentEur: 9 })])).toMatchObject({
      state: "degrade",
      scope: "global_daily",
    });
  });

  it("denies at one hundred percent", () => {
    expect(evaluateBudgets([snapshot({ spentEur: 10 })])).toMatchObject({
      state: "deny",
      scope: "global_daily",
    });
  });

  it("honours a per-scope threshold rather than the default", () => {
    expect(
      evaluateBudgets([snapshot({ spentEur: 5, warnPct: 0.4, degradePct: 0.45 })]),
    ).toMatchObject({ state: "degrade" });
  });

  it("counts the projected cost of the call it is gating", () => {
    const snapshots = [snapshot({ spentEur: 9.99 })];

    expect(evaluateBudgets(snapshots, 0)).toMatchObject({ state: "degrade" });
    expect(evaluateBudgets(snapshots, 0.02)).toMatchObject({ state: "deny" });
  });

  it("takes the worst state across every scope", () => {
    const decision = evaluateBudgets([
      snapshot({ scope: "global_daily", spentEur: 1 }),
      snapshot({ scope: "per_user_daily", scopeKey: "hash-a", limitEur: 1, spentEur: 1 }),
    ]);

    expect(decision).toMatchObject({ state: "deny", scope: "per_user_daily" });
  });

  it("fails closed when the counters cannot be read", () => {
    // An unreadable counter is not an empty one. Treating it as zero spend is
    // how a broken budget becomes an unlimited one.
    const decision = evaluateBudgets(null);

    expect(decision.state).toBe("deny");
    expect(decision.detail).toMatch(/unavailable/i);
  });

  it("denies when a scope has a zero limit", () => {
    expect(evaluateBudgets([snapshot({ limitEur: 0 })])).toMatchObject({
      state: "deny",
    });
  });

  it("allows when no scope has a configured limit at all", () => {
    // No configured limits is a deployment decision, not a missing reading.
    expect(evaluateBudgets([])).toMatchObject({ state: "allow" });
  });

  it("keeps one learner's exhaustion off another learner", () => {
    const exhausted = evaluateBudgets([
      snapshot({ scope: "per_user_daily", scopeKey: "hash-a", limitEur: 1, spentEur: 1 }),
      snapshot({ scope: "global_daily", spentEur: 1 }),
    ]);
    const untouched = evaluateBudgets([
      snapshot({ scope: "per_user_daily", scopeKey: "hash-b", limitEur: 1, spentEur: 0 }),
      snapshot({ scope: "global_daily", spentEur: 1 }),
    ]);

    expect(exhausted.state).toBe("deny");
    expect(untouched.state).toBe("allow");
  });

  it("names every scope the routing document defines", () => {
    expect([...BUDGET_SCOPES]).toEqual([
      "per_request",
      "per_user_daily",
      "per_user_monthly",
      "global_daily",
    ]);
  });
});

describe("counter periods", () => {
  const now = new Date("2026-08-21T13:45:12.000Z");

  it("gives the daily scope a UTC day", () => {
    const { start, end } = periodFor("global_daily", now);

    expect(start.toISOString()).toBe("2026-08-21T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  it("gives the monthly scope a calendar month", () => {
    const { start, end } = periodFor("per_user_monthly", now);

    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls a December month into the next year", () => {
    const { end } = periodFor("per_user_monthly", new Date("2026-12-31T23:59:00.000Z"));

    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("does not persist a per-request period", () => {
    // per_request is an accumulator on the request context, not a counter row.
    // Writing one per request would grow a table with no reader.
    expect(() => periodFor("per_request", now)).toThrow(/per_request/);
  });
});
