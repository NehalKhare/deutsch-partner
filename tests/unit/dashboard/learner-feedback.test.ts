import { describe, expect, it } from "vitest";

import { learnerFeedbackSummarySchema } from "@/domain/trainer-coaching";
import {
  FEEDBACK_NOTES_SHOWN,
  createLearnerFeedbackRepository,
  percent,
  unhelpfulShare,
} from "@/lib/dashboard/learner-feedback";
import { createFakeSupabase } from "../../support/fake-supabase";

/**
 * The operator's read of learner feedback: one function call, one validated
 * document, and two small figures derived from it.
 */

const DOCUMENT = {
  generatedAt: "2026-09-14T12:00:00.000Z",
  window: { from: "2026-08-15T12:00:00.000Z", to: "2026-09-14T12:00:00.000Z", days: 30 },
  totals: { votes: 4, helpful: 3, unhelpful: 1, learners: 2, noted: 1 },
  byReason: [{ reason: "too_long", count: 1 }],
  byPromptVersion: [{ promptVersion: 11, votes: 4, helpful: 3, unhelpful: 1 }],
  byTool: [{ tool: "get_review_session", votes: 4, unhelpful: 1 }],
  recentNotes: [
    {
      note: "shorter please",
      verdict: "unhelpful",
      reasons: ["too_long"],
      createdAt: "2026-09-14T11:00:00.000Z",
    },
  ],
};

describe("reading the summary", () => {
  it("calls the database function with the window and the note cap", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: DOCUMENT });

    const result = await createLearnerFeedbackRepository(fake.client).summary({ days: 30 });

    expect(result.ok).toBe(true);
    expect(fake.rpcCalls).toEqual([
      { fn: "learner_feedback_summary", args: { p_days: 30, p_notes: FEEDBACK_NOTES_SHOWN } },
    ]);
  });

  it("decodes dates and holds the reasons to the closed set", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: DOCUMENT });

    const result = await createLearnerFeedbackRepository(fake.client).summary({ days: 30 });

    expect(result.ok && result.data.generatedAt).toBeInstanceOf(Date);
    expect(result.ok && result.data.recentNotes[0]?.createdAt).toBeInstanceOf(Date);

    expect(
      learnerFeedbackSummarySchema.safeParse({
        ...DOCUMENT,
        byReason: [{ reason: "rude", count: 1 }],
      }).success,
    ).toBe(false);
  });

  it("refuses a window it was never meant to answer", async () => {
    const fake = createFakeSupabase({});

    const result = await createLearnerFeedbackRepository(fake.client).summary({ days: 0 });

    expect(result.ok).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("reports a database failure as a repository error", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ error: { code: "XX000", message: "boom" } });

    const result = await createLearnerFeedbackRepository(fake.client).summary({ days: 30 });

    expect(result.ok).toBe(false);
  });
});

describe("the figures", () => {
  it("divides unhelpful by votes and refuses to divide by nothing", () => {
    expect(unhelpfulShare({ votes: 4, unhelpful: 1 })).toBe(0.25);
    expect(unhelpfulShare({ votes: 0, unhelpful: 0 })).toBeNull();
  });

  it("renders a share as a whole percentage, or a dash", () => {
    expect(percent(0.25)).toBe("25%");
    expect(percent(0.333)).toBe("33%");
    expect(percent(null)).toBe("—");
  });
});
