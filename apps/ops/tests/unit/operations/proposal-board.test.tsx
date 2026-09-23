import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProposalBoard } from "@/components/operations/proposal-board";
import type {
  BoardProposal,
  BoardRun,
  ProductOpsBoard,
} from "@dp/domain/product-ops";
import { workerCommandFor } from "@dp/product-ops/view";

/**
 * The board an operator reads before deciding anything.
 *
 * What is checked here is that it can be read: that each column is a landmark
 * with a name, that a card says whose move it is, and that a stage only a CLI
 * worker can run offers the command rather than a button that would lie about
 * what this page can do.
 */

const PROPOSAL: BoardProposal = {
  id: "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
  runId: "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f",
  title: "Medical German module",
  titleSlug: "medical-german-module",
  status: "pending_review",
  complexity: "medium",
  priorityScore: 78,
  createdAt: new Date("2026-09-10T10:00:00.000Z"),
  updatedAt: new Date("2026-09-10T10:00:00.000Z"),
  runStage: "human_review",
  runStatus: "awaiting_review",
  reviewCount: 0,
  hasPrd: false,
  hasPlan: false,
  pullRequest: null,
};

const RUN: BoardRun = {
  id: "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f",
  runType: "manual_market_scan",
  status: "running",
  stage: "research",
  errorCode: null,
  startedAt: new Date("2026-09-10T10:00:00.000Z"),
  completedAt: null,
  updatedAt: new Date("2026-09-10T10:00:00.000Z"),
};

const board = (over: Partial<ProductOpsBoard> = {}): ProductOpsBoard => ({
  generatedAt: new Date("2026-09-10T12:00:00.000Z"),
  proposals: [PROPOSAL],
  runs: [RUN],
  ...over,
});

describe("the board", () => {
  it("says so plainly when there is nothing on it", () => {
    render(<ProposalBoard board={board({ proposals: [] })} />);

    expect(screen.getByText(/nothing proposed yet/i)).toBeInTheDocument();
  });

  it("gives every column a heading, so the page has landmarks", () => {
    render(<ProposalBoard board={board()} />);

    for (const label of [
      /awaiting you/i,
      /in progress/i,
      /in code review/i,
      /plan accepted/i,
      /closed/i,
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
  });

  it("counts what is in each column in its own heading", () => {
    render(<ProposalBoard board={board()} />);

    expect(
      screen.getByRole("heading", { name: /awaiting you \(1\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /plan accepted \(0\)/i }),
    ).toBeInTheDocument();
  });

  it("opens a card onto the proposal it names", () => {
    render(<ProposalBoard board={board()} />);

    expect(
      screen.getByRole("link", { name: "Medical German module" }),
    ).toHaveAttribute("href", `/product/${PROPOSAL.id}`);
  });

  it("says what to do next, on the card", () => {
    render(<ProposalBoard board={board()} />);

    expect(screen.getByText(/approve it to generate a prd/i)).toBeInTheDocument();
  });

  it("offers the worker command rather than a button it cannot honour", () => {
    render(
      <ProposalBoard
        board={board({
          proposals: [{ ...PROPOSAL, status: "coding", runStage: "implementation" }],
        })}
      />,
    );

    expect(screen.getByText(workerCommandFor(PROPOSAL.id))).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("links a pull request an operator can open", () => {
    render(
      <ProposalBoard
        board={board({
          proposals: [
            {
              ...PROPOSAL,
              status: "pr_open",
              runStage: "completed",
              runStatus: "completed",
              pullRequest: { number: 7, url: "https://git.test/7", status: "open" },
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute(
      "href",
      "https://git.test/7",
    );
  });

  it("shows a pull request number that has no url yet without a dead link", () => {
    render(
      <ProposalBoard
        board={board({
          proposals: [
            {
              ...PROPOSAL,
              status: "pr_open",
              pullRequest: { number: 7, url: null, status: "open" },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "#7" })).not.toBeInTheDocument();
  });
});
