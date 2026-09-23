import { describe, expect, it } from "vitest";

import {
  costSummarySchema,
  spendAlerts,
  spendPerLearner,
  spendPerLearnerUsd,
  pricedInEur,
  conversionRate,
  inEur,
  worstAlert,
  type CostSummary,
} from "@/lib/costs";

const COST_ROW = {
  window: { from: "2026-08-20T12:00:00.000Z", to: "2026-08-21T12:00:00.000Z" },
  totals: {
    call_count: 400,
    learner_count: 20,
    cost_eur: 12.5,
    cost_usd: 13.6,
    cost_usd_unpriced: 0,
    input_tokens: 300_000,
    output_tokens: 60_000,
    failures: 3,
    budget_denials: 0,
    truncations: 0,
    degraded: 0,
    unpriced: 0,
    carried_forward: 0,
  },
  byTask: [
    {
      task: "conversation.turn",
      tier: "strong",
      calls: 200,
      costEur: 10,
      costUsd: 10.87,
      costUsdUnpriced: 0,
      inputTokens: 200_000,
      outputTokens: 50_000,
    },
  ],
  byModel: [
    { modelId: "vendor/model", calls: 400, costEur: 12.5, costUsd: 13.6, costUsdUnpriced: 0 },
  ],
  fxRate: [{ rate: 0.92, rateDate: "2026-08-21", source: "ecb" }],
};

const costs = costSummarySchema.parse(COST_ROW) as CostSummary;

/** Every row written before any rate existed: dollars exact, euro stored zero. */
const UNPRICED = costSummarySchema.parse({
  ...COST_ROW,
  totals: {
    ...COST_ROW.totals,
    cost_eur: 0,
    cost_usd_unpriced: COST_ROW.totals.cost_usd,
    unpriced: COST_ROW.totals.call_count,
  },
  byTask: [{ ...COST_ROW.byTask[0], costEur: 0, costUsdUnpriced: COST_ROW.byTask[0].costUsd }],
}) as CostSummary;

/** The same, with no rate to convert them at either. */
const NOTHING_PRICED = { ...UNPRICED, fxRate: [] };

describe("the cost summary", () => {
  it("validates what the ledger aggregated", () => {
    expect(costSummarySchema.safeParse(COST_ROW).success).toBe(true);
  });

  it("carries the rate behind every euro figure", () => {
    // A euro number derived from an unstated rate is not auditable.
    expect(costs.fxRate[0]).toMatchObject({ rate: 0.92, rateDate: "2026-08-21" });
  });

  it("divides spend across the learners who caused it", () => {
    expect(spendPerLearner(costs)).toBeCloseTo(0.625, 6);
  });

  it("does not divide by nobody", () => {
    expect(
      spendPerLearner({ ...costs, totals: { ...costs.totals, learner_count: 0 } }),
    ).toBe(0);
  });

  it("reports the dollars the provider charged as well as the euro", () => {
    // The euro figure is derived and can be zero for a window that cost real
    // money. The dollar one is what was billed, and it is on every row.
    expect(costs.totals.cost_usd).toBeCloseTo(13.6, 6);
    expect(spendPerLearnerUsd(costs)).toBeCloseTo(0.68, 6);
  });

  it("still reports cost per learner in dollars when nothing could be priced", () => {
    // Exactly the state a cold deployment is in: real spend, no rate, and a
    // euro column of zeros. The number that decides whether this ships must
    // not read zero along with it.
    expect(spendPerLearner(NOTHING_PRICED)).toBe(0);
    expect(spendPerLearnerUsd(NOTHING_PRICED)).toBeCloseTo(0.68, 6);
  });

  it("does not divide dollars by nobody either", () => {
    expect(
      spendPerLearnerUsd({ ...costs, totals: { ...costs.totals, learner_count: 0 } }),
    ).toBe(0);
  });
});

describe("completing the euro column", () => {
  it("leaves a fully priced window exactly as the ledger stored it", () => {
    // Nothing to estimate, so nothing is estimated. The figures on this page
    // are what the provider charged, converted on the day it charged them.
    const euro = pricedInEur(costs);

    expect(euro).toEqual({
      total: 12.5,
      charged: 12.5,
      estimated: 0,
      estimatedCalls: 0,
    });
  });

  it("converts the rows that carry no rate, at the newest one", () => {
    // 13.6 dollars at 0.92 to the dollar, and no stored euro to add it to.
    const euro = pricedInEur(UNPRICED);

    expect(euro.estimated).toBeCloseTo(12.512, 6);
    expect(euro.total).toBeCloseTo(12.512, 6);
    expect(euro.estimatedCalls).toBe(400);
  });

  it("adds the estimate to what was charged rather than replacing it", () => {
    // The mixed window: some rows priced on the day, some never priced. Adding
    // today's rate to the whole dollar column would count the first group
    // twice, which is the reason the split is reported at all.
    const mixed = {
      ...costs,
      totals: { ...costs.totals, cost_usd_unpriced: 1, unpriced: 30 },
    };
    const euro = pricedInEur(mixed);

    expect(euro.charged).toBe(12.5);
    expect(euro.estimated).toBeCloseTo(0.92, 6);
    expect(euro.total).toBeCloseTo(13.42, 6);
  });

  it("keeps the two apart, because they are not the same claim", () => {
    // One is what was billed. The other is right about the magnitude and
    // cannot be right about the day. The page says which is which.
    const euro = pricedInEur(UNPRICED);

    expect(euro.charged).toBe(0);
    expect(euro.estimated).toBeGreaterThan(0);
  });

  it("estimates nothing when there is no rate to estimate with", () => {
    expect(pricedInEur(NOTHING_PRICED)).toEqual({
      total: 0,
      charged: 0,
      estimated: 0,
      estimatedCalls: 0,
    });
    expect(conversionRate(NOTHING_PRICED)).toBeUndefined();
  });

  it("completes a breakdown row the same way it completes the total", () => {
    const row = UNPRICED.byTask[0];

    expect(inEur(row.costEur, row.costUsdUnpriced, conversionRate(UNPRICED))).toBeCloseTo(
      10.87 * 0.92,
      6,
    );
  });

  it("leaves a breakdown row alone when there is no rate", () => {
    expect(inEur(10, 5, undefined)).toBe(10);
  });

  it("rounds to the precision the ledger's columns store", () => {
    // Money is stored to eight places. A figure with more of them is a figure
    // that will not add up against the rows it came from.
    expect(inEur(0, 1 / 3, 0.92)).toBe(0.30666667);
  });

  it("counts the completed figure against the daily limit", () => {
    // A limit checked against a column that reads zero for every unpriced row
    // is a limit nothing can ever reach.
    const heavy = {
      ...UNPRICED,
      totals: { ...UNPRICED.totals, cost_usd_unpriced: 100 },
    };

    expect(spendAlerts(heavy, { globalDailyEur: 100 })[0]?.level).toBe("degrade");
  });

  it("divides the completed figure across the learners who caused it", () => {
    expect(spendPerLearner(UNPRICED)).toBeCloseTo(12.512 / 20, 6);
  });
});

describe("spend alerts", () => {
  const at = (cost: number) => ({ ...costs, totals: { ...costs.totals, cost_eur: cost } });

  it("says nothing when spend is comfortable", () => {
    expect(spendAlerts(at(10), { globalDailyEur: 100 })).toEqual([]);
  });

  it("warns at seventy percent", () => {
    expect(spendAlerts(at(70), { globalDailyEur: 100 })[0].level).toBe("warn");
  });

  it("escalates at ninety and at a hundred", () => {
    expect(spendAlerts(at(90), { globalDailyEur: 100 })[0].level).toBe("degrade");
    expect(spendAlerts(at(100), { globalDailyEur: 100 })[0].level).toBe("deny");
  });

  it("uses the same thresholds the gateway gates on", () => {
    // The screen and the enforcement must not disagree about whether today is
    // fine.
    expect(spendAlerts(at(69.9), { globalDailyEur: 100 })).toEqual([]);
    expect(spendAlerts(at(70), { globalDailyEur: 100 })).toHaveLength(1);
  });

  it("raises a denial as its own alert, because it is an audit event", () => {
    const alerts = spendAlerts(
      { ...costs, totals: { ...costs.totals, budget_denials: 4 } },
      { globalDailyEur: 100 },
    );

    expect(alerts.map((alert) => alert.scope)).toContain("budget_denied");
  });

  it("raises unpriced calls only when no rate exists to convert them at", () => {
    expect(spendAlerts(NOTHING_PRICED, { globalDailyEur: 100 }).map((a) => a.scope)).toContain(
      "fx_unpriced",
    );
  });

  it("says nothing about unpriced calls it was able to convert", () => {
    // They are in the euro total now, at a stated rate, with the page saying
    // how much of the figure that is. A banner on top of that is noise.
    const alerts = spendAlerts(
      { ...costs, totals: { ...costs.totals, unpriced: 12, cost_usd_unpriced: 0.5 } },
      { globalDailyEur: 100 },
    );

    expect(alerts.map((alert) => alert.scope)).not.toContain("fx_unpriced");
  });

  it("says nothing about a rate carried forward, which priced its rows correctly", () => {
    // A weekend. The rate is not today's, every row that used it says so, and
    // all of them are priced. An alert that fires on this is an alert that is
    // always on, which is an alert nobody reads.
    const alerts = spendAlerts(
      { ...costs, totals: { ...costs.totals, carried_forward: 400 } },
      { globalDailyEur: 100 },
    );

    expect(alerts).toEqual([]);
  });

  it("raises a snapshot job that has stopped running", () => {
    const alerts = spendAlerts(
      { ...costs, fxRate: [{ rate: 0.92, rateDate: "2026-08-01", source: "ecb" }] },
      { globalDailyEur: 100 },
    );

    expect(alerts.map((alert) => alert.scope)).toContain("fx_pipeline");
  });

  it("tolerates a rate a long weekend old", () => {
    // The source publishes on business days and the window ends on the 21st.
    const alerts = spendAlerts(
      { ...costs, fxRate: [{ rate: 0.92, rateDate: "2026-08-18", source: "ecb" }] },
      { globalDailyEur: 100 },
    );

    expect(alerts).toEqual([]);
  });

  it("raises a rate table that has never been filled", () => {
    const alerts = spendAlerts({ ...costs, fxRate: [] }, { globalDailyEur: 100 });

    expect(alerts.map((alert) => alert.scope)).toContain("fx_pipeline");
  });

  it("says nothing about the rate on a window with no calls in it", () => {
    const idle = {
      ...costs,
      totals: { ...costs.totals, call_count: 0, cost_eur: 0, cost_usd: 0 },
      fxRate: [],
    };

    expect(spendAlerts(idle, { globalDailyEur: 100 })).toEqual([]);
  });

  it("raises truncations, which are replies a learner did not finish reading", () => {
    const alerts = spendAlerts(
      { ...costs, totals: { ...costs.totals, truncations: 2 } },
      { globalDailyEur: 100 },
    );

    expect(alerts.map((alert) => alert.scope)).toContain("truncated");
  });

  it("denies when no limit is configured, rather than treating it as unlimited", () => {
    expect(spendAlerts(at(1), { globalDailyEur: 0 })[0].level).toBe("deny");
  });

  it("reports the worst state across every alert", () => {
    expect(
      worstAlert([
        { level: "warn", scope: "a", detail: "" },
        { level: "deny", scope: "b", detail: "" },
      ]),
    ).toBe("deny");
  });

  it("reports ok when there is nothing to report", () => {
    expect(worstAlert([])).toBe("ok");
  });
});
