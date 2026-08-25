import { describe, expect, it } from "vitest";

import {
  RECENCY_WINDOW,
  TIEBREAK_EPSILON,
  WEIGHTS,
  isTie,
  rankCandidates,
  scoreCandidate,
  type Candidate,
} from "@/learning/recommendation-ranking";
import {
  bandScores,
  candidatesFor,
  createDashboardRepository,
  currentLevelTally,
  learnerSummarySchema,
  levelProgress,
  recommendNext,
  type LearnerSummary,
} from "@/lib/dashboard/summary";
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
} from "@/lib/dashboard/costs";
import { isOperator, operatorIds, parseOperatorIds } from "@/lib/auth/operator";
import { createFakeSupabase } from "../../support/fake-supabase";

// --- the learner dashboard ---------------------------------------------------

const SUMMARY_ROW = {
  level: {
    selected: "A2",
    estimated: "A2",
    effective: "A2",
    plus: false,
    miniLevel: 26,
  },
  miniLevel: {
    number: 26,
    theme: "Unterwegs",
    focus: "getting around a German city",
    targetVocabulary: ["der Zug", "die Haltestelle"],
    conversationFunctions: ["buy a ticket"],
  },
  skills: { fluency: 0.4, comprehension: 0.5, confidence: 0.3 },
  vocabulary: { total: 120, mastered: 30, learning: 60, due: 8, weak: 4 },
  levelScores: [
    { miniLevel: 24, score: "0.900", turns: 10, strongTurns: 9 },
    { miniLevel: 25, score: "0.700", turns: 10, strongTurns: 7 },
    { miniLevel: 26, score: "0.750", turns: 4, strongTurns: 3 },
  ],
  recurringMistakes: [
    { errorType: "case_dative", pattern: "uses the accusative after mit", occurrences: 5 },
  ],
  recentThreads: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Unterwegs",
      topic: "travel",
      updatedAt: "2026-08-21T10:00:00.000Z",
    },
  ],
  generatedAt: "2026-08-21T12:00:00.000Z",
};

const summary = learnerSummarySchema.parse(SUMMARY_ROW);

describe("the learner summary", () => {
  it("comes from one aggregated call, not six", () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: SUMMARY_ROW });

    void createDashboardRepository(fake.client).summary();

    expect(fake.calls).toEqual([]);
  });

  it("passes no learner id, because the function reads the session", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: SUMMARY_ROW });

    await createDashboardRepository(fake.client).summary(
      new Date("2026-08-21T12:00:00.000Z"),
    );

    expect(fake.rpcCalls[0].fn).toBe("learner_dashboard");
    expect(Object.keys(fake.rpcCalls[0].args ?? {})).toEqual(["p_now"]);
  });

  it("validates the shape rather than trusting it", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: { ...SUMMARY_ROW, level: { ...SUMMARY_ROW.level, effective: "C1" } },
    });

    const outcome = await createDashboardRepository(fake.client).summary();

    expect(outcome.ok).toBe(false);
  });

  it("reports an unreadable summary rather than rendering zeroes", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ error: { code: "57014", message: "canceled" } });

    expect((await createDashboardRepository(fake.client).summary()).ok).toBe(false);
  });
});

describe("progress through a level", () => {
  it("is measured against the level's own target", () => {
    expect(levelProgress(summary, 60)).toBeCloseTo(0.5, 6);
  });

  it("never exceeds complete", () => {
    expect(levelProgress(summary, 10)).toBe(1);
  });

  it("is zero when the level asks for nothing", () => {
    expect(levelProgress(summary, 0)).toBe(0);
  });
});

// --- recommendations ---------------------------------------------------------

const candidate = (over: Partial<Candidate["inputs"]> = {}): Candidate => ({
  activityType: "conversation",
  title: "Talk",
  reason: { kind: "level_progression", miniLevel: 26 },
  inputs: {
    overdueReviewItems: 0,
    unresolvedErrors: 0,
    levelDistance: 0,
    matchesInterest: false,
    turnsSinceRecommended: null,
    addsDiversity: false,
    ...over,
  },
});

describe("ranking what to do next", () => {
  it("weights the six signals the routing document names", () => {
    expect(Object.keys(WEIGHTS).sort()).toEqual([
      "diversity",
      "interest",
      "levelFit",
      "recency",
      "reviewDue",
      "weakness",
    ]);
  });

  it("sums to one, so a score is a fraction of something", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("puts overdue review above everything else", () => {
    expect(WEIGHTS.reviewDue).toBeGreaterThan(WEIGHTS.interest);
    expect(WEIGHTS.reviewDue).toBeGreaterThan(WEIGHTS.diversity);
  });

  it("saturates the review signal, because overdue is overdue", () => {
    const some = scoreCandidate(candidate({ overdueReviewItems: 12 }));
    const lots = scoreCandidate(candidate({ overdueReviewItems: 400 }));

    expect(lots.parts.reviewDue).toBe(some.parts.reviewDue);
  });

  it("penalises something suggested a moment ago", () => {
    const justNow = scoreCandidate(candidate({ turnsSinceRecommended: 0 }));
    const while_ = scoreCandidate(candidate({ turnsSinceRecommended: RECENCY_WINDOW }));

    expect(justNow.parts.recency).toBeLessThan(while_.parts.recency);
  });

  it("treats never-suggested as fully fresh", () => {
    expect(scoreCandidate(candidate({ turnsSinceRecommended: null })).parts.recency).toBe(1);
  });

  it("scores an off-level activity down", () => {
    expect(scoreCandidate(candidate({ levelDistance: 6 })).parts.levelFit).toBeLessThan(
      scoreCandidate(candidate({ levelDistance: 0 })).parts.levelFit,
    );
  });

  it("orders highest first and breaks ties the same way every time", () => {
    const ranked = rankCandidates([
      { ...candidate(), activityType: "review" },
      { ...candidate(), activityType: "conversation" },
    ]);

    expect(ranked.map((entry) => entry.candidate.activityType)).toEqual([
      "conversation",
      "review",
    ]);
  });

  it("says when the top two are too close to mean anything", () => {
    const ranked = rankCandidates([
      { ...candidate(), activityType: "review" },
      { ...candidate(), activityType: "conversation" },
    ]);

    expect(isTie(ranked)).toBe(true);
    expect(TIEBREAK_EPSILON).toBeGreaterThan(0);
  });

  it("says when the top two are not close", () => {
    const ranked = rankCandidates([
      { ...candidate({ overdueReviewItems: 12 }), activityType: "review" },
      { ...candidate(), activityType: "conversation" },
    ]);

    expect(isTie(ranked)).toBe(false);
  });
});

describe("what the dashboard offers", () => {
  it("offers review when words are due", () => {
    const types = candidatesFor(summary, []).map((entry) => entry.activityType);

    expect(types).toContain("review");
  });

  it("offers nothing about review when nothing is due", () => {
    const quiet = {
      ...summary,
      vocabulary: { ...summary.vocabulary, due: 0, weak: 0 },
      recurringMistakes: [],
    };

    expect(candidatesFor(quiet, []).map((entry) => entry.activityType)).toEqual([
      "conversation",
    ]);
  });

  it("puts overdue review in front of a conversation", () => {
    // Eight overdue words is a real signal; a conversation is always available.
    expect(recommendNext(summary, [])?.candidate.activityType).toBe("review");
  });

  it("always has something to offer", () => {
    const brandNew: LearnerSummary = {
      ...summary,
      vocabulary: { total: 0, mastered: 0, learning: 0, due: 0, weak: 0 },
      recurringMistakes: [],
      recentThreads: [],
    };

    expect(recommendNext(brandNew, [])?.candidate.activityType).toBe("conversation");
  });

  it("explains itself with a structured reason, not free text", () => {
    expect(recommendNext(summary, [])?.candidate.reason).toMatchObject({
      kind: "review_due",
    });
  });
});

// --- the cost dashboard ------------------------------------------------------

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

describe("who counts as an operator", () => {
  it("is nobody when the allowlist is unset", () => {
    // The safe reading of an absent allowlist.
    expect(operatorIds()).toEqual([]);
    expect(isOperator("11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("is nobody for a null caller", () => {
    expect(isOperator(null)).toBe(false);
  });

  it("reads a well-formed allowlist", () => {
    expect(
      parseOperatorIds(
        " 11111111-1111-4111-8111-111111111111 , 22222222-2222-4222-8222-222222222222 ",
      ),
    ).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("is nobody when one entry is malformed", () => {
    // Not a partial allowlist. Guessing which half was meant is how an
    // operator route quietly opens.
    expect(
      parseOperatorIds("11111111-1111-4111-8111-111111111111,not-a-uuid"),
    ).toEqual([]);
  });

  it("is nobody for an empty or absent allowlist", () => {
    expect(parseOperatorIds(undefined)).toEqual([]);
    expect(parseOperatorIds("")).toEqual([]);
    expect(parseOperatorIds("   ")).toEqual([]);
  });

  it("treats a wildcard as malformed rather than as everybody", () => {
    expect(parseOperatorIds("*")).toEqual([]);
  });
});


describe("what the levels amount to", () => {
  it("averages a band over the levels actually practised", () => {
    const [a1, a2, b1] = bandScores(summary.levelScores);

    // 24, 25 and 26 are all A2 levels: (0.9 + 0.7 + 0.75) / 3.
    expect(a2?.averageScore).toBeCloseTo(0.7833, 3);
    expect(a2?.practised).toBe(3);
    expect(a1?.averageScore).toBeNull();
    expect(a1?.practised).toBe(0);
    expect(b1?.averageScore).toBeNull();
  });

  it("says how much of the band the average covers", () => {
    const [a1, a2] = bandScores(summary.levelScores);

    expect(a1?.of).toBeGreaterThan(0);
    expect(a2?.of).toBeGreaterThan(0);
    expect(a2!.practised).toBeLessThanOrEqual(a2!.of);
  });

  it("counts a band's first and last mini-levels as its own", () => {
    // The boundary levels are the easiest to lose to an off-by-one, and A2's
    // first level is exactly where a fresh A2 learner's only score lives.
    const scores = learnerSummarySchema.parse({
      ...SUMMARY_ROW,
      levelScores: [
        { miniLevel: 16, score: "0.6", turns: 5, strongTurns: 3 },
        { miniLevel: 35, score: "1.0", turns: 5, strongTurns: 5 },
      ],
    }).levelScores;
    const [, a2] = bandScores(scores);

    expect(a2?.practised).toBe(2);
    expect(a2?.averageScore).toBeCloseTo(0.8, 6);
  });

  it("never dilutes an average with unpractised zeros", () => {
    // One strong level must read as one strong level, not as one-fifteenth.
    const [, a2] = bandScores(
      learnerSummarySchema.parse({
        ...SUMMARY_ROW,
        levelScores: [{ miniLevel: 20, score: "1.0", turns: 5, strongTurns: 5 }],
      }).levelScores,
    );

    expect(a2?.averageScore).toBe(1);
    expect(a2?.practised).toBe(1);
  });

  it("ignores a zero-turn row, which is a level nobody was evaluated at", () => {
    const [, a2] = bandScores(
      learnerSummarySchema.parse({
        ...SUMMARY_ROW,
        levelScores: [{ miniLevel: 20, score: "0", turns: 0, strongTurns: 0 }],
      }).levelScores,
    );

    expect(a2?.averageScore).toBeNull();
  });

  it("finds the tally for the level the learner is standing on", () => {
    expect(currentLevelTally(summary)).toMatchObject({
      miniLevel: 26,
      turns: 4,
      strongTurns: 3,
    });
  });

  it("returns null when the current level has no evaluated turns yet", () => {
    const fresh = learnerSummarySchema.parse({ ...SUMMARY_ROW, levelScores: [] });

    expect(currentLevelTally(fresh)).toBeNull();
  });
});
