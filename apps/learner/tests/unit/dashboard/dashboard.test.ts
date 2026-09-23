import { describe, expect, it } from "vitest";

import {
  RECENCY_WINDOW,
  TIEBREAK_EPSILON,
  WEIGHTS,
  isTie,
  rankCandidates,
  scoreCandidate,
  type Candidate,
} from "@dp/learning/recommendation-ranking";
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
import { createFakeSupabase } from "@dp/test-support/fake-supabase";

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
