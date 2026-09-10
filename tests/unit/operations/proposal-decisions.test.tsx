import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProposalDecisions } from "@/components/operations/proposal-decisions";
import { PRODUCT_OPS_STAGES } from "@/domain/product-ops";

/**
 * The human gate, as a control surface.
 *
 * The property worth holding is that a button exists only where the
 * compare-and-set behind it would succeed. The transition is checked against
 * the run's stage, so an approval offered at any other stage is an approval
 * that silently does nothing — and an operator pressing a button that does
 * nothing is worse than one seeing no button at all.
 */

const PROPOSAL_ID = "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

function renderPanel(stage: Parameters<typeof ProposalDecisions>[0]["stage"]) {
  const review = vi.fn(async () => {});
  const rendered = render(
    <ProposalDecisions
      proposalId={PROPOSAL_ID}
      priorityScore={78}
      stage={stage}
      review={review}
    />,
  );

  return { ...rendered, review };
}

describe("at the proposal gate", () => {
  it("offers the approval that writes a PRD, and a rejection", () => {
    renderPanel("human_review");

    expect(
      screen.getByRole("button", { name: /approve, and write the prd/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
    // Not the plan approval: there is no plan yet, and approving one is a
    // different and much more consequential decision.
    expect(
      screen.queryByRole("button", { name: /accept the plan/i }),
    ).not.toBeInTheDocument();
  });

  it("posts the proposal and the action it means", () => {
    const { container } = renderPanel("human_review");
    const form = screen
      .getByRole("button", { name: /approve, and write the prd/i })
      .closest("form");

    expect(form?.querySelector('input[name="proposalId"]')).toHaveAttribute(
      "value",
      PROPOSAL_ID,
    );
    expect(form?.querySelector('input[name="action"]')).toHaveAttribute(
      "value",
      "approve",
    );
    expect(container.querySelectorAll('input[name="action"]').length).toBeGreaterThan(1);
  });
});

describe("at the plan gate", () => {
  it("offers to accept the plan and says the run ends there", () => {
    renderPanel("plan_review");

    expect(
      screen.getByRole("button", { name: /accept the plan/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing in this workflow writes to the repository/i)).toBeInTheDocument();
    expect(screen.getByText(/copy the plan first/i)).toBeInTheDocument();
  });

  it("does not offer the proposal approval again", () => {
    renderPanel("plan_review");

    expect(
      screen.queryByRole("button", { name: /write the prd/i }),
    ).not.toBeInTheDocument();
  });
});

describe("anywhere else", () => {
  it("offers no approval at all", () => {
    for (const stage of PRODUCT_OPS_STAGES) {
      if (stage === "human_review" || stage === "plan_review") continue;

      const { unmount } = renderPanel(stage);

      expect(
        screen.queryByRole("button", { name: /approve/i }),
        stage,
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^reject$/i }),
        stage,
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("still records a comment and a priority change", () => {
    renderPanel("research");

    expect(
      screen.getByRole("button", { name: /leave a comment/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /change the priority/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not waiting on you/i)).toBeInTheDocument();
  });

  it("offers nothing to approve when the run could not be read", () => {
    // Fail closed: an undetermined stage is not a stage at a gate.
    renderPanel(null);

    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
  });
});

describe("the priority override", () => {
  it("starts from the score the pipeline computed", () => {
    renderPanel("human_review");

    expect(screen.getByLabelText(/priority/i)).toHaveValue(78);
  });

  it("bounds what can be typed to the scoring range", () => {
    renderPanel("human_review");

    const input = screen.getByLabelText(/priority/i);
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "100");
  });

  it("says the score is derived, so an override reads as one", () => {
    renderPanel("human_review");

    expect(screen.getByText(/deliberate override/i)).toBeInTheDocument();
  });
});
