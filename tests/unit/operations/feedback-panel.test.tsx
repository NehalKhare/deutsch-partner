import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FeedbackPanel } from "@/components/operations/feedback-panel";
import type { LearnerFeedbackSummary } from "@/domain/trainer-coaching";

/**
 * The operator's view of learner feedback: readable at a glance, honest when
 * empty, and never a place a learner is named.
 */

const AT = new Date("2026-09-14T12:00:00.000Z");

const SUMMARY: LearnerFeedbackSummary = {
  generatedAt: AT,
  window: { from: new Date("2026-08-15T12:00:00.000Z"), to: AT, days: 30 },
  totals: { votes: 20, helpful: 12, unhelpful: 8, learners: 6, noted: 2 },
  byReason: [
    { reason: "too_long", count: 5 },
    { reason: "wrong_correction", count: 1 },
  ],
  byPromptVersion: [
    { promptVersion: 11, votes: 15, helpful: 10, unhelpful: 5 },
    { promptVersion: 10, votes: 5, helpful: 2, unhelpful: 3 },
  ],
  byTool: [{ tool: "get_review_session", votes: 18, unhelpful: 7 }],
  recentNotes: [
    {
      note: "<b>Fewer examples</b> please",
      verdict: "unhelpful",
      reasons: ["too_long"],
      createdAt: AT,
    },
  ],
};

describe("with feedback to show", () => {
  it("leads with the totals and the unhelpful share", () => {
    render(<FeedbackPanel summary={SUMMARY} />);

    // The tiles come first in the document; the table's headers share two
    // of the words further down.
    const tile = (label: string) => screen.getAllByText(label)[0].nextSibling;
    expect(tile("Votes")).toHaveTextContent("20");
    expect(tile("Unhelpful")).toHaveTextContent("40%");
    expect(tile("Learners")).toHaveTextContent("6");
  });

  it("ranks the reasons in words and tables the prompt versions", () => {
    render(<FeedbackPanel summary={SUMMARY} />);

    expect(screen.getByText("Too long")).toBeInTheDocument();
    expect(screen.getByText("The correction was wrong")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "v11" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "60%" })).toBeInTheDocument();
    expect(screen.getByText(/get_review_session \(7\/18\)/)).toBeInTheDocument();
  });

  it("quotes notes as text, never as markup", () => {
    const { container } = render(<FeedbackPanel summary={SUMMARY} />);

    expect(screen.getByText(/Fewer examples/)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("with nothing yet", () => {
  it("says so in a sentence instead of drawing empty charts", () => {
    render(
      <FeedbackPanel
        summary={{
          ...SUMMARY,
          totals: { votes: 0, helpful: 0, unhelpful: 0, learners: 0, noted: 0 },
          byReason: [],
          byPromptVersion: [],
          byTool: [],
          recentNotes: [],
        }}
      />,
    );

    expect(screen.getByText(/no learner has rated a trainer reply/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
