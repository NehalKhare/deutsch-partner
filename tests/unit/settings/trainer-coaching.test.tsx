import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TrainerCoachingSettings } from "@/components/settings/trainer-coaching";
import { defaultCoachingProfile } from "@/domain/trainer-coaching";

/**
 * What the settings page says about the trainer's learning, and the door out.
 * Guardrails S15: a learner can see what is remembered and clear it.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";
const AT = new Date("2026-09-14T12:00:00.000Z");
const IDLE = { status: "idle" as const, message: null };

describe("a trainer that has adapted", () => {
  it("lists the dials in the session's own words and counts the votes", () => {
    render(
      <TrainerCoachingSettings
        profile={{
          ...defaultCoachingProfile(LEARNER, AT),
          explanationDepth: "brief",
          focus: "grammar",
          helpfulCount: 2,
          unhelpfulCount: 3,
          disputedCorrections: 1,
        }}
        action={vi.fn()}
        initialState={IDLE}
      />,
    );

    expect(screen.getByText(/brief explanations, a grammar focus/)).toBeInTheDocument();
    expect(screen.getByText(/learned from 5 votes, including 1 disputed correction/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /forget my feedback/i })).toBeInTheDocument();
  });

  it("submits the reset and shows the action's answer", async () => {
    const action = vi.fn(async () => ({
      status: "saved" as const,
      message: "Forgotten. Your next session starts from the defaults.",
    }));
    render(
      <TrainerCoachingSettings
        profile={defaultCoachingProfile(LEARNER, AT)}
        action={action}
        initialState={IDLE}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /forget my feedback/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/forgotten/i);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("a trainer that has not", () => {
  it("explains how to teach it and offers nothing to forget", () => {
    render(<TrainerCoachingSettings profile={null} action={vi.fn()} initialState={IDLE} />);

    expect(screen.getByText(/default settings/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
