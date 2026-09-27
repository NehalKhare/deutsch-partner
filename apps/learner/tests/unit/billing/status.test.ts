import { describe, expect, it } from "vitest";

import type { SubscriptionGrant } from "@dp/domain/billing";

import { UNREADABLE_STANDING, type BillingStanding } from "@/lib/billing/standing";
import { planNotices, planStatusLine } from "@/lib/billing/status";

/**
 * The one line that says what a learner has and until when, on settings and
 * on Plan & billing, and the notices that go with it. A renewal date, an end
 * date and a trial's end are three different promises and must never be
 * written as each other.
 */

const PERIOD_END = new Date("2026-10-12T09:30:00Z");

const subscription = (over: Partial<SubscriptionGrant> = {}): SubscriptionGrant => ({
  planCode: "plus",
  status: "active",
  currentPeriodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  ...over,
});

const onSubscription = (over: Partial<SubscriptionGrant> = {}): BillingStanding => {
  const granting = subscription(over);
  const trialing = granting.status === "trialing";
  return {
    readable: true,
    entitlement: { plan: granting.planCode, source: "subscription", until: granting.currentPeriodEnd },
    subscription: granting,
    paidSubscription: trialing ? null : granting,
    trial: trialing ? granting : null,
    passes: [],
    hasCustomer: true,
    trialEligible: false,
    trialUsed: granting.trialEnd !== null,
  };
};

describe("planStatusLine", () => {
  it("says Free plainly", () => {
    expect(
      planStatusLine({ ...UNREADABLE_STANDING, readable: true, trialEligible: true }),
    ).toBe("Free, with daily limits and no card.");
  });

  it("says when a subscription renews", () => {
    expect(planStatusLine(onSubscription())).toBe("Plus · renews on 12 October 2026");
  });

  it("says when a cancelled subscription ends, and that it will not renew", () => {
    expect(planStatusLine(onSubscription({ cancelAtPeriodEnd: true }))).toBe(
      "Plus · ends on 12 October 2026 and will not renew",
    );
  });

  it("says when a trial ends", () => {
    expect(
      planStatusLine(
        onSubscription({ planCode: "premium", status: "trialing", trialEnd: new Date("2026-10-08T12:00:00Z") }),
      ),
    ).toBe("Premium trial · ends on 8 October 2026");
  });

  it("says when a pass ends", () => {
    expect(
      planStatusLine({
        ...UNREADABLE_STANDING,
        readable: true,
        entitlement: { plan: "premium", source: "pass", until: PERIOD_END },
        hasCustomer: true,
        trialEligible: true,
      }),
    ).toBe("Premium pass · until 12 October 2026");
  });

  it("says the plan could not be read, rather than calling a subscriber Free", () => {
    expect(planStatusLine(UNREADABLE_STANDING)).toBe("Your plan could not be read just now.");
  });
});

describe("planNotices", () => {
  it("warns about a failed payment while access continues", () => {
    const notices = planNotices(onSubscription({ status: "past_due" }));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.tone).toBe("warning");
    expect(notices[0]?.text).toMatch(/payment did not go through/i);
    expect(notices[0]?.text).toMatch(/Manage billing/);
  });

  it("says a trial ends by itself and charges nothing", () => {
    const notices = planNotices(
      onSubscription({ planCode: "premium", status: "trialing", trialEnd: new Date("2026-10-08T12:00:00Z") }),
    );
    expect(notices.map((notice) => notice.tone)).toEqual(["info"]);
    expect(notices[0]?.text).toMatch(/nothing is charged/i);
  });

  it("says what carries on after a trial beside a plan already ordered — not Free", () => {
    const trial = subscription({ planCode: "premium", status: "trialing", trialEnd: new Date("2026-10-08T12:00:00Z") });
    const plus = subscription();
    const notices = planNotices({ ...onSubscription(), subscription: trial, trial, paidSubscription: plus });

    expect(notices[0]?.text).toMatch(/your Plus subscription carries on/i);
    expect(notices[0]?.text).not.toMatch(/Free carries on/);
  });

  it("has nothing to say about a healthy subscription or Free", () => {
    expect(planNotices(onSubscription())).toEqual([]);
    expect(planNotices({ ...UNREADABLE_STANDING, readable: true })).toEqual([]);
  });
});
