import { describe, expect, it } from "vitest";

import {
  ENFORCED_BUDGET_SCOPES,
  PLAN_BUDGET_KEYS,
  budgetLimitInputSchema,
  budgetScopeKeySchema,
  budgetState,
  eurAmountSchema,
  isPlanBudgetKey,
  percentSchema,
  planBudgetKey,
  planForBudgetKey,
} from "../src/budgets";
import { PLAN_CODES } from "../src/plans";

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

describe("a plan's own budget key", () => {
  it("is 'plan:' and the plan's code, one per plan", () => {
    // billing-and-plans-spec.md S9: budget_limits keyed 'plan:<code>'.
    expect(PLAN_BUDGET_KEYS).toEqual(["plan:free", "plan:plus", "plan:premium"]);
    expect(PLAN_CODES.map(planBudgetKey)).toEqual(PLAN_BUDGET_KEYS);
  });

  it("reads back to the plan it names, and to nothing otherwise", () => {
    expect(planForBudgetKey("plan:premium")).toBe("premium");
    expect(isPlanBudgetKey("plan:free")).toBe(true);

    for (const key of [null, HASH, "plan:gold", "plan:", "PLAN:free", "plan:free "]) {
      expect(planForBudgetKey(key), String(key)).toBeNull();
      expect(isPlanBudgetKey(key), String(key)).toBe(false);
    }
  });

  it("is, with the learner pseudonym, the only key a limit may carry", () => {
    expect(budgetScopeKeySchema.parse("plan:plus")).toBe("plan:plus");
    expect(budgetScopeKeySchema.parse(HASH)).toBe(HASH);

    const refused = budgetScopeKeySchema.safeParse("plan:gold");
    expect(refused.success).toBe(false);
    // One message the form can show, not a union's list of two failures.
    expect(refused.error?.issues).toHaveLength(1);
    expect(refused.error?.issues[0]?.message).toBe("a learner pseudonym or a plan");
  });
});

describe("a plan default as an operator submits it", () => {
  const base = {
    scope: "per_user_monthly",
    scopeKey: "plan:free",
    limitEur: "1.00",
    warnPct: "70",
    degradePct: "90",
    active: true,
  };

  it("parses for a per-learner scope", () => {
    expect(budgetLimitInputSchema.parse(base)).toMatchObject({
      scope: "per_user_monthly",
      scopeKey: "plan:free",
      limitEur: "1.00",
    });
    expect(budgetLimitInputSchema.parse({ ...base, scope: "per_user_daily" }).scopeKey).toBe(
      "plan:free",
    );
  });

  it("refuses a plan that does not exist", () => {
    expect(budgetLimitInputSchema.safeParse({ ...base, scopeKey: "plan:gold" }).success).toBe(false);
  });

  it("refuses a plan key on the global scope, which is nobody's plan", () => {
    expect(budgetLimitInputSchema.safeParse({ ...base, scope: "global_daily" }).success).toBe(false);
  });

  it("refuses to switch a plan's default off, as it refuses a scope's", () => {
    // Paused, every learner on the plan would fall through to the scope's
    // default — or to no limit at all where the scope has none.
    const result = budgetLimitInputSchema.safeParse({ ...base, active: false });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["active"]);
  });
});
