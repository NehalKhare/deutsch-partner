import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TrainerInvite } from "@/components/review/trainer-invite";

/**
 * The way into the Trainer.
 *
 * Since the Trainer left the navigation this is the only route to it and the
 * only place that says it exists, so the two things worth pinning are that it
 * goes where it claims to and that it names what a learner is being offered.
 * A button that only said "practise" would leave somebody never learning they
 * have a personal trainer at all.
 */

describe("the trainer invite", () => {
  it("goes to the trainer", () => {
    render(<TrainerInvite />);

    expect(screen.getByRole("link", { name: /perfect your mistakes/i })).toHaveAttribute(
      "href",
      "/trainer",
    );
  });

  it("says what the learner has, not just what the page does", () => {
    render(<TrainerInvite />);

    expect(screen.getByText(/your personal trainer/i)).toBeInTheDocument();
  });

  it("offers to fix something, which is the reason to open it", () => {
    render(<TrainerInvite />);

    expect(screen.getByText(/perfect your mistakes/i)).toBeInTheDocument();
  });

  it("reads as one control, both lines inside the same link", () => {
    // Two links side by side would be two tab stops and two things to aim at.
    render(<TrainerInvite />);

    const link = screen.getByRole("link", { name: /perfect your mistakes/i });
    expect(link).toHaveTextContent(/your personal trainer/i);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("keeps the arrow away from a screen reader", () => {
    // It is a direction, not a word. Read aloud it is noise in the middle of
    // the only sentence that matters here.
    render(<TrainerInvite />);

    expect(screen.getByText("→")).toHaveAttribute("aria-hidden");
  });
});
