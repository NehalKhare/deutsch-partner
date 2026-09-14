import { describe, expect, it } from "vitest";

import { marketFindingSchema } from "@/domain/product-ops";
import type { LearnerFeedbackSummary } from "@/domain/trainer-coaching";
import {
  MIN_FEEDBACK_VOTES,
  feedbackFinding,
  feedbackForAgent,
} from "@/lib/product-ops/feedback";

/**
 * Learner feedback as a research finding.
 *
 * Arithmetic, pinned: too few votes is no finding, the counts are the
 * evidence, the reasons become pain points in learners' terms, and the
 * finding passes the same schema a web finding does so it can be stored and
 * read back beside them.
 */

const AT = new Date("2026-09-14T12:00:00.000Z");

export function summaryOf(over: Partial<LearnerFeedbackSummary> = {}): LearnerFeedbackSummary {
  return {
    generatedAt: AT,
    window: { from: new Date("2026-08-15T12:00:00.000Z"), to: AT, days: 30 },
    totals: { votes: 20, helpful: 12, unhelpful: 8, learners: 6, noted: 3 },
    byReason: [
      { reason: "too_long", count: 5 },
      { reason: "unclear", count: 2 },
      { reason: "wrong_correction", count: 1 },
      { reason: "too_easy", count: 1 },
    ],
    byPromptVersion: [
      { promptVersion: 11, votes: 15, helpful: 10, unhelpful: 5 },
      { promptVersion: 10, votes: 5, helpful: 2, unhelpful: 3 },
    ],
    byTool: [
      { tool: "get_review_session", votes: 18, unhelpful: 7 },
      { tool: "fetch_simple_german_news", votes: 4, unhelpful: 1 },
    ],
    recentNotes: [
      {
        note: "Please fewer examples",
        verdict: "unhelpful",
        reasons: ["too_long"],
        createdAt: AT,
      },
    ],
    ...over,
  };
}

describe("when there is enough feedback", () => {
  it("is one internal finding that passes the market finding schema", () => {
    const finding = feedbackFinding(summaryOf());

    expect(finding).not.toBeNull();
    expect(marketFindingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({ sourceType: "internal", relevanceScore: 0.9 });
    expect(finding?.sourceUrl).toBeUndefined();
  });

  it("states the counts and the share in its title and summary", () => {
    const finding = feedbackFinding(summaryOf());

    expect(finding?.title).toBe(
      "Learner feedback on the trainer: 20 votes in 30 days, 40% unhelpful",
    );
    expect(finding?.summary).toContain("6 learners rated 20 trainer replies");
    expect(finding?.summary).toContain("8 were marked unhelpful");
    expect(finding?.summary).toContain("too long, unclear, the correction was wrong");
  });

  it("turns the top three reasons into pain points in learners' terms", () => {
    const finding = feedbackFinding(summaryOf());

    expect(finding?.painPoints).toEqual([
      "Replies too long (5 votes)",
      "Replies unclear (2 votes)",
      "Corrections learners disputed (1 vote)",
    ]);
  });

  it("reports each prompt version's unhelpful share as a trend", () => {
    const finding = feedbackFinding(summaryOf());

    expect(finding?.trends).toEqual([
      "Trainer prompt v11: 15 votes, 33% unhelpful",
      "Trainer prompt v10: 5 votes, 60% unhelpful",
    ]);
  });

  it("names the most flagged tool as evidence, without a url", () => {
    const finding = feedbackFinding(summaryOf());

    expect(finding?.evidence).toEqual([
      { finding: "3 of the votes carried a note in the learner's own words." },
      {
        finding:
          "Replies that used get_review_session drew the most unhelpful votes (7 of 18).",
      },
    ]);
  });

  it("copes with votes that carry no reasons at all", () => {
    const finding = feedbackFinding(summaryOf({ byReason: [], byTool: [] }));

    expect(finding?.painPoints).toEqual([]);
    expect(finding?.summary).toContain("No reasons were attached");
    expect(finding?.evidence).toHaveLength(1);
  });
});

describe("when there is too little", () => {
  it("is no finding rather than a trend drawn from a handful of votes", () => {
    const thin = summaryOf({
      totals: { votes: MIN_FEEDBACK_VOTES - 1, helpful: 2, unhelpful: 2, learners: 2, noted: 0 },
    });

    expect(feedbackFinding(thin)).toBeNull();
  });

  it("is a finding at exactly the threshold", () => {
    const enough = summaryOf({
      totals: { votes: MIN_FEEDBACK_VOTES, helpful: 3, unhelpful: 2, learners: 2, noted: 0 },
    });

    expect(feedbackFinding(enough)).not.toBeNull();
  });
});

describe("what the research agent's tool hands over", () => {
  it("carries the counts, labelled reasons and a bounded set of notes", () => {
    const view = feedbackForAgent(summaryOf());

    expect(view).toMatchObject({
      windowDays: 30,
      totals: { votes: 20, unhelpful: 8 },
      unhelpfulShare: 0.4,
    });
    expect(view.byReason).toEqual([
      { reason: "too_long", label: "Too long", count: 5 },
      { reason: "unclear", label: "Unclear", count: 2 },
      { reason: "wrong_correction", label: "The correction was wrong", count: 1 },
      { reason: "too_easy", label: "Too easy", count: 1 },
    ]);
    expect(view.notes).toEqual([
      { note: "Please fewer examples", verdict: "unhelpful", reasons: ["too_long"] },
    ]);
  });

  it("caps the notes at ten and the tools at five", () => {
    const many = summaryOf({
      recentNotes: Array.from({ length: 20 }, (_, index) => ({
        note: `note ${index}`,
        verdict: "helpful" as const,
        reasons: [],
        createdAt: AT,
      })),
      byTool: Array.from({ length: 8 }, (_, index) => ({
        tool: `tool_${index}`,
        votes: 1,
        unhelpful: 0,
      })),
    });

    const view = feedbackForAgent(many);

    expect(view.notes).toHaveLength(10);
    expect(view.byTool).toHaveLength(5);
  });
});
