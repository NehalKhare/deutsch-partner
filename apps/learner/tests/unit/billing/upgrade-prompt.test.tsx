import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { planRefusalFrom, type PlanRefusal } from "@/lib/billing/refusal";

/**
 * What a learner sees when their plan says no (billing-and-plans-spec.md S4):
 * what happened, when it reopens, that their progress is saved, and — below
 * the top plan only — where the larger plans are. Never the red alert, which
 * means "your turn did not happen for a reason you cannot act on".
 */

const NOW = new Date("2026-10-01T15:00:00.000Z");

const refusal = (over: Partial<PlanRefusal> = {}): PlanRefusal =>
  planRefusalFrom({
    error: "quota_exhausted",
    message: "You've used today's tutor turns.",
    resetAt: "2026-10-02T09:30:00.000Z",
    upgrade: true,
    ...over,
  })!;

describe("the prompt", () => {
  it("says what happened, when it reopens and that progress is saved", () => {
    const { container } = render(
      <UpgradePrompt refusal={refusal()} now={NOW} clock={{ locale: "en-GB", timeZone: "UTC" }} />,
    );

    const prompt = container.querySelector("[data-refusal]")!;
    expect(prompt).toHaveTextContent("You've used today's tutor turns.");
    expect(prompt).toHaveTextContent("Back tomorrow at 09:30.");
    expect(prompt).toHaveTextContent("Your progress is saved.");
  });

  it("is never the alert a failed turn raises, nor a live region of its own", () => {
    // The page announces it, from a polite region that was there first.
    render(<UpgradePrompt refusal={refusal()} now={NOW} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows where the larger plans are when one would help", () => {
    render(<UpgradePrompt refusal={refusal()} now={NOW} />);

    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/pricing");
  });

  it("sells a Premium learner nothing, and still says when it reopens", () => {
    render(
      <UpgradePrompt
        refusal={refusal({ upgrade: false })}
        now={NOW}
        clock={{ locale: "en-GB", timeZone: "UTC" }}
      />,
    );

    expect(screen.queryByRole("link", { name: /see plans/i })).not.toBeInTheDocument();
    expect(document.querySelector("[data-refusal]")).toHaveTextContent("Back tomorrow at 09:30.");
  });

  it("points at what stays open on every plan", () => {
    // Reviews are never gated (spec S4): a learner out of tutor turns can
    // still climb the ladder they have already built.
    render(<UpgradePrompt refusal={refusal()} now={NOW} />);

    expect(screen.getByRole("link", { name: /catch up/i })).toHaveAttribute("href", "/review");
  });

  it("names a renewal date for a spent allowance", () => {
    render(
      <UpgradePrompt
        refusal={refusal({
          error: "budget_exhausted",
          message: "You've used your AI allowance for now.",
          resetAt: "2026-11-01T00:00:00.000Z",
        })}
        now={NOW}
        clock={{ locale: "en-GB", timeZone: "UTC" }}
      />,
    );

    expect(document.querySelector("[data-refusal]")).toHaveTextContent("Renews on 1 November.");
  });

  it("gives a feature the plan lacks no time, because nothing reopens", () => {
    render(
      <UpgradePrompt
        refusal={refusal({ error: "plan_required", message: "That needs a paid plan.", resetAt: null })}
        now={NOW}
      />,
    );

    expect(document.querySelector("[data-refusal]")).not.toHaveTextContent(/back|renews/i);
  });
});

describe("the quiet note", () => {
  it("is one line with a way to put it away", async () => {
    const onDismiss = vi.fn();
    render(
      <UpgradePrompt refusal={refusal()} now={NOW} variant="note" onDismiss={onDismiss}>
        {"Your device's voice is reading replies instead."}
      </UpgradePrompt>,
    );

    expect(document.querySelector("[data-refusal]")).toHaveTextContent("Your device's voice is reading replies instead.");
    await userEvent.setup().click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("offers no dismissal it cannot keep", () => {
    render(<UpgradePrompt refusal={refusal()} now={NOW} variant="note" />);

    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
