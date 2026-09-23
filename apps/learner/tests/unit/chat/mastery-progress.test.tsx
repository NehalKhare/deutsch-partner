import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MasteryProgress } from "@/components/chat/mastery-progress";

/**
 * The mastery strip, on its own.
 *
 * What matters is that it never contradicts the gate: the bar is full only
 * when the gate is open, the dots are the seven-turn evidence floor, and a
 * verdict appears only when the parent saw a turn get counted.
 */

function bar() {
  return screen.getByRole("progressbar");
}

describe("the bar", () => {
  it("starts empty when nothing has been evaluated", () => {
    render(<MasteryProgress tally={{ turns: 0, strongTurns: 0 }} lastTurn={null} />);

    expect(bar()).toHaveAttribute("aria-valuenow", "0");
  });

  it("shows the strong-turn ratio against the gate's target", () => {
    // 4 of 7 strong is ~0.57 against the 0.8 bar.
    render(<MasteryProgress tally={{ turns: 7, strongTurns: 4 }} lastTurn={null} />);

    expect(bar()).toHaveAttribute("aria-valuenow", "71");
  });

  it("is full at six strong turns in seven", () => {
    render(<MasteryProgress tally={{ turns: 7, strongTurns: 6 }} lastTurn={null} />);

    expect(bar()).toHaveAttribute("aria-valuenow", "100");
  });

  it("stays well short of full on two clean turns", () => {
    // The bug this guards against: 2 for 2 error-free used to draw 100%.
    render(<MasteryProgress tally={{ turns: 2, strongTurns: 2 }} lastTurn={null} />);

    expect(bar()).toHaveAttribute("aria-valuenow", "29");
  });
});

describe("the evidence floor", () => {
  it("fills one dot per evaluated turn", () => {
    const { container } = render(
      <MasteryProgress tally={{ turns: 3, strongTurns: 2 }} lastTurn={null} />,
    );

    expect(container.querySelectorAll("[data-dot='filled']")).toHaveLength(3);
    expect(container.querySelectorAll("[data-dot='empty']")).toHaveLength(4);
    expect(screen.getByText("3 of 7 evaluated turns")).toBeInTheDocument();
  });

  it("never draws more than the seven the gate asks for", () => {
    const { container } = render(
      <MasteryProgress tally={{ turns: 12, strongTurns: 9 }} lastTurn={null} />,
    );

    expect(container.querySelectorAll("[data-dot='filled']")).toHaveLength(7);
    expect(container.querySelectorAll("[data-dot='empty']")).toHaveLength(0);
  });
});

describe("the verdict on the newest turn", () => {
  it("credits an error-free turn", () => {
    const { container } = render(
      <MasteryProgress tally={{ turns: 1, strongTurns: 1 }} lastTurn="strong" />,
    );

    expect(container.querySelector("[data-turn-quality='strong']")).toHaveTextContent(
      "+ error-free",
    );
  });

  it("names a turn with errors", () => {
    const { container } = render(
      <MasteryProgress tally={{ turns: 2, strongTurns: 1 }} lastTurn="weak" />,
    );

    expect(container.querySelector("[data-turn-quality='weak']")).toHaveTextContent(
      "− had errors",
    );
  });

  it("says nothing when no turn was counted", () => {
    const { container } = render(
      <MasteryProgress tally={{ turns: 2, strongTurns: 1 }} lastTurn={null} />,
    );

    expect(container.querySelector("[data-turn-quality]")).toBeNull();
  });
});

describe("the learner's own pass mark", () => {
  it("fills the bar against the chosen threshold, not the default", () => {
    // 4 of 7 strong: part-way up the 80% default, full at 50%.
    render(
      <MasteryProgress
        tally={{ turns: 7, strongTurns: 4 }}
        lastTurn={null}
        threshold={50}
      />,
    );

    expect(bar()).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText(/ready to move up/i)).toBeInTheDocument();
  });

  it("names the threshold to a screen reader", () => {
    render(
      <MasteryProgress
        tally={{ turns: 7, strongTurns: 4 }}
        lastTurn={null}
        threshold={50}
      />,
    );

    expect(bar()).toHaveAttribute("aria-label", expect.stringContaining("50%"));
  });
});

describe("when the gate is open", () => {
  it("says the learner is ready, without promising a move they did not ask for", () => {
    render(<MasteryProgress tally={{ turns: 7, strongTurns: 6 }} lastTurn={null} />);

    expect(screen.getByText(/ready to move up/i)).toBeInTheDocument();
  });

  it("promises nothing while the evidence floor blocks the gate", () => {
    // Two clean turns are a mood; the gate wants seven turns of evidence.
    render(<MasteryProgress tally={{ turns: 2, strongTurns: 2 }} lastTurn={null} />);

    expect(screen.queryByText(/ready to move up/i)).not.toBeInTheDocument();
  });
});
