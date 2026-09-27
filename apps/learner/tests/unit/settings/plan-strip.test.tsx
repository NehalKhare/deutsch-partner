import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PlanStrip } from "@/components/settings/plan-strip";
import { UNREADABLE_STANDING, type BillingStanding } from "@/lib/billing/standing";

/**
 * "Your plan" on settings: stated, not edited, with the way to where it is
 * changed — the same shape as the level strip above it.
 */

const FREE: BillingStanding = { ...UNREADABLE_STANDING, readable: true, trialEligible: true };

describe("the plan strip", () => {
  it("names the plan and links Plan & billing", () => {
    render(<PlanStrip standing={FREE} />);

    expect(screen.getByRole("region", { name: "Your plan" })).toHaveTextContent("Free, with daily limits and no card.");
    expect(screen.getByRole("link", { name: /plan & billing/i })).toHaveAttribute("href", "/billing");
  });

  it("says when a subscription renews", () => {
    const end = new Date("2026-10-12T09:30:00Z");
    const premium = {
      planCode: "premium" as const,
      status: "active" as const,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      trialEnd: null,
    };
    render(
      <PlanStrip
        standing={{
          ...FREE,
          entitlement: { plan: "premium", source: "subscription", until: end },
          subscription: premium,
          paidSubscription: premium,
          hasCustomer: true,
          trialEligible: false,
        }}
      />,
    );

    expect(screen.getByText("Premium · renews on 12 October 2026")).toBeInTheDocument();
  });

  it("says when the plan could not be read", () => {
    render(<PlanStrip standing={UNREADABLE_STANDING} />);

    expect(screen.getByText(/could not be read just now/i)).toBeInTheDocument();
  });
});
