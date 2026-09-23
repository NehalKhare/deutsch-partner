import { describe, expect, it } from "vitest";

import {
  ENFORCED_BUDGET_SCOPES,
  budgetLimitInputSchema,
  budgetState,
  eurAmountSchema,
  percentSchema,
} from "../src/budgets";

const HASH = "0123456789abcdef0123456789abcdef";

describe("budget state", () => {
  it("allows below the warn threshold", () => {
    expect(budgetState({ limitEur: 10, spentEur: 6.9, warnPct: 0.7, degradePct: 0.9 })).toBe("allow");
  });

  it("warns, degrades and denies at the thresholds themselves", () => {
    const at = (spentEur: number) =>
      budgetState({ limitEur: 10, spentEur, warnPct: 0.7, degradePct: 0.9 });

    expect(at(7)).toBe("warn");
    expect(at(9)).toBe("degrade");
    expect(at(10)).toBe("deny");
  });

  it("counts what the next call is projected to cost", () => {
    expect(
      budgetState({ limitEur: 10, spentEur: 9.5, warnPct: 0.7, degradePct: 0.9 }, 0.5),
    ).toBe("deny");
  });

  it("treats a zero limit as a closed door, not an unlimited one", () => {
    expect(budgetState({ limitEur: 0, spentEur: 0, warnPct: 0.7, degradePct: 0.9 })).toBe("deny");
  });
});

describe("the scopes an operator can set", () => {
  it("are the three the gateway reads from the table", () => {
    // per_request is a constant in code; a row for it would be read by nothing.
    expect(ENFORCED_BUDGET_SCOPES).toEqual(["global_daily", "per_user_daily", "per_user_monthly"]);
  });
});

describe("a euro amount", () => {
  it("stays a decimal string, never a float", () => {
    expect(eurAmountSchema.parse(" 12.5 ")).toBe("12.5");
    expect(eurAmountSchema.parse("0")).toBe("0");
    expect(eurAmountSchema.parse("0.0001")).toBe("0.0001");
  });

  it("accepts a comma as the decimal separator, as a de-DE keyboard types it", () => {
    expect(eurAmountSchema.parse("12,50")).toBe("12.50");
  });

  it("refuses more precision than the column stores", () => {
    expect(eurAmountSchema.safeParse("1.00001").success).toBe(false);
  });

  it("refuses negatives, exponents and words", () => {
    for (const value of ["-1", "1e3", "ten", "", "1.2.3"]) {
      expect(eurAmountSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("refuses anything above the sanity ceiling, so a slipped digit is not a budget", () => {
    expect(eurAmountSchema.safeParse("10000").success).toBe(true);
    expect(eurAmountSchema.safeParse("10000.0001").success).toBe(false);
    expect(eurAmountSchema.safeParse("50000").success).toBe(false);
  });
});

describe("a threshold percentage", () => {
  it("becomes the fraction the column stores", () => {
    expect(percentSchema.parse("70")).toBe("0.70");
    expect(percentSchema.parse("100")).toBe("1.00");
    expect(percentSchema.parse("5")).toBe("0.05");
  });

  it("is a whole number between 1 and 100", () => {
    for (const value of ["0", "101", "70.5", "-5", ""]) {
      expect(percentSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("a budget limit as an operator submits it", () => {
  const base = {
    scope: "per_user_daily",
    scopeKey: null,
    limitEur: "0.50",
    warnPct: "70",
    degradePct: "90",
    active: true,
  };

  it("parses a default for a scope", () => {
    expect(budgetLimitInputSchema.parse(base)).toEqual({
      scope: "per_user_daily",
      scopeKey: null,
      limitEur: "0.50",
      warnPct: "0.70",
      degradePct: "0.90",
      active: true,
    });
  });

  it("parses a per-learner override keyed by the ledger's pseudonym", () => {
    expect(budgetLimitInputSchema.parse({ ...base, scopeKey: HASH }).scopeKey).toBe(HASH);
  });

  it("treats a blank key as the scope's default", () => {
    expect(budgetLimitInputSchema.parse({ ...base, scopeKey: "  " }).scopeKey).toBeNull();
  });

  it("refuses a key that is not a pseudonym", () => {
    // An email or an account id here would put an identifier in an operator table.
    for (const scopeKey of ["alice@example.com", "11111111-1111-4111-8111-111111111111", "abc"]) {
      expect(budgetLimitInputSchema.safeParse({ ...base, scopeKey }).success, scopeKey).toBe(false);
    }
  });

  it("refuses a key on the global scope, which budget_snapshot would never match", () => {
    expect(
      budgetLimitInputSchema.safeParse({ ...base, scope: "global_daily", scopeKey: HASH }).success,
    ).toBe(false);
  });

  it("refuses per_request, which nothing reads from the table", () => {
    expect(budgetLimitInputSchema.safeParse({ ...base, scope: "per_request" }).success).toBe(false);
  });

  it("refuses a warn threshold above the degrade threshold", () => {
    expect(
      budgetLimitInputSchema.safeParse({ ...base, warnPct: "95", degradePct: "90" }).success,
    ).toBe(false);
  });

  it("refuses to switch off a scope's default, which would leave the scope unlimited", () => {
    expect(budgetLimitInputSchema.safeParse({ ...base, active: false }).success).toBe(false);
    expect(
      budgetLimitInputSchema.safeParse({ ...base, scopeKey: HASH, active: false }).success,
    ).toBe(true);
  });
});
