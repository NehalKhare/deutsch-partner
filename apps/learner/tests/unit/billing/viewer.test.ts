import { beforeEach, describe, expect, it, vi } from "vitest";

import { UNREADABLE_STANDING, type BillingStanding } from "@/lib/billing/standing";

/**
 * Who is looking at a pricing card. Signed out is the common case and costs
 * one claims check; signed in adds the learner's own billing read, which the
 * rest of the request shares.
 */

const getAuthenticatedUserId = vi.fn();
const currentBilling = vi.fn();

vi.mock("@/lib/auth/current-user", () => ({ getAuthenticatedUserId: () => getAuthenticatedUserId() }));
vi.mock("@/lib/billing/entitlement", () => ({ currentBilling: (id: string) => currentBilling(id) }));

const { pricingViewer } = await import("@/lib/billing/viewer");

const LEARNER = "11111111-1111-4111-8111-111111111111";

const PLUS = {
  planCode: "plus" as const,
  status: "active" as const,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
};

const standing = (over: Partial<BillingStanding> = {}): BillingStanding => ({
  ...UNREADABLE_STANDING,
  readable: true,
  trialEligible: true,
  ...over,
});

beforeEach(() => {
  getAuthenticatedUserId.mockReset();
  currentBilling.mockReset();
});

describe("pricingViewer", () => {
  it("is signed out without reading any billing row", async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    expect(await pricingViewer()).toEqual({ signedIn: false, plan: null, subscribed: false, trialing: false, trialEligible: true });
    expect(currentBilling).not.toHaveBeenCalled();
  });

  it("is the learner's plan and trial eligibility when signed in", async () => {
    getAuthenticatedUserId.mockResolvedValue(LEARNER);
    currentBilling.mockResolvedValue(standing());

    expect(await pricingViewer()).toEqual({ signedIn: true, plan: "free", subscribed: false, trialing: false, trialEligible: true });
    expect(currentBilling).toHaveBeenCalledWith(LEARNER);
  });

  it("knows a subscriber, so a card sends them to change plan rather than buy a second", async () => {
    getAuthenticatedUserId.mockResolvedValue(LEARNER);
    currentBilling.mockResolvedValue(
      standing({
        entitlement: { plan: "plus", source: "subscription", until: null },
        subscription: PLUS,
        paidSubscription: PLUS,
        trialEligible: false,
      }),
    );

    expect(await pricingViewer()).toMatchObject({ plan: "plus", subscribed: true, trialing: false, trialEligible: false });
  });

  it("knows a learner on the trial is not a subscriber, so the cards lead to the order page", async () => {
    // A trial pays for nothing; counting it as a subscription left the
    // Customer Portal as the only way from trial to paid (spec S6).
    const trial = { ...PLUS, planCode: "premium" as const, status: "trialing" as const, trialEnd: new Date() };
    getAuthenticatedUserId.mockResolvedValue(LEARNER);
    currentBilling.mockResolvedValue(
      standing({
        entitlement: { plan: "premium", source: "subscription", until: null },
        subscription: trial,
        trial,
        trialEligible: false,
      }),
    );

    expect(await pricingViewer()).toMatchObject({ plan: "premium", subscribed: false, trialing: true });
  });

  it("is signed in and offered no trial when the billing rows could not be read", async () => {
    getAuthenticatedUserId.mockResolvedValue(LEARNER);
    currentBilling.mockResolvedValue(UNREADABLE_STANDING);

    expect(await pricingViewer()).toEqual({ signedIn: true, plan: "free", subscribed: false, trialing: false, trialEligible: false });
  });
});
