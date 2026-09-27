import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LearnerBillingGrants } from "@dp/db/billing-repository";
import type { SubscriptionGrant } from "@dp/domain/billing";

/**
 * Which plan a learner has, as the pages and (next) the routes read it.
 *
 * The rule is the domain's; what is tested here is the reading around it:
 * the rows come from the learner's own RLS client, a failed read is free and
 * says it failed, and the subscription a page shows is the one that grants.
 */

const warn = vi.fn();
const grantsFor = vi.fn();

vi.mock("@/lib/api/composition", () => ({
  billingLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
  createLearnerBilling: async () => ({ grantsFor, subscriptionsFor: vi.fn() }),
}));

const { currentBilling, currentEntitlement, planForRequest, standingFrom } = await import(
  "@/lib/billing/entitlement"
);

const LEARNER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 86_400_000;

const subscription = (over: Partial<SubscriptionGrant> = {}): SubscriptionGrant => ({
  planCode: "plus",
  status: "active",
  currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY),
  cancelAtPeriodEnd: false,
  trialEnd: null,
  ...over,
});

const grants = (over: Partial<LearnerBillingGrants> = {}): LearnerBillingGrants => ({
  customerId: null,
  subscriptions: [],
  passes: [],
  hasEverSubscribed: false,
  ...over,
});

beforeEach(() => {
  warn.mockReset();
  grantsFor.mockReset();
});

describe("standingFrom", () => {
  it("is Free, eligible for the trial, for a learner with no rows", () => {
    const standing = standingFrom(grants(), NOW);
    expect(standing).toMatchObject({
      readable: true,
      entitlement: { plan: "free", source: "free", until: null },
      subscription: null,
      hasCustomer: false,
      trialEligible: true,
    });
  });

  it("is the subscription's plan, and carries the subscription for its dates", () => {
    const active = subscription();
    const standing = standingFrom(grants({ customerId: "cus_1", subscriptions: [active], hasEverSubscribed: true }), NOW);
    expect(standing.entitlement).toMatchObject({ plan: "plus", source: "subscription" });
    expect(standing.subscription).toEqual(active);
    expect(standing.hasCustomer).toBe(true);
    expect(standing.trialEligible).toBe(false);
  });

  it("keeps showing a subscription that grants under a higher pass", () => {
    // Plus renews underneath a Premium pass; the renewal date still matters.
    const plus = subscription();
    const standing = standingFrom(
      grants({
        subscriptions: [plus],
        passes: [
          {
            planCode: "premium",
            startsAt: new Date(NOW.getTime() - DAY),
            endsAt: new Date(NOW.getTime() + 30 * DAY),
            revokedAt: null,
          },
        ],
        hasEverSubscribed: true,
      }),
      NOW,
    );
    expect(standing.entitlement).toMatchObject({ plan: "premium", source: "pass" });
    expect(standing.subscription).toEqual(plus);
  });

  it("shows no subscription that has stopped granting", () => {
    const standing = standingFrom(
      grants({ subscriptions: [subscription({ status: "canceled" })], hasEverSubscribed: true }),
      NOW,
    );
    expect(standing.subscription).toBeNull();
    expect(standing.entitlement.plan).toBe("free");
    expect(standing.trialEligible).toBe(false);
  });

  it("keeps a past-due subscription, which still grants during Stripe's retries", () => {
    const late = subscription({ status: "past_due" });
    expect(standingFrom(grants({ subscriptions: [late], hasEverSubscribed: true }), NOW).subscription).toEqual(late);
  });
});

describe("currentBilling", () => {
  it("reads the learner's own rows and resolves them", async () => {
    grantsFor.mockResolvedValue({ ok: true, data: grants({ subscriptions: [subscription()], hasEverSubscribed: true }) });

    const standing = await currentBilling(LEARNER);

    expect(grantsFor).toHaveBeenCalledWith(LEARNER);
    expect(standing.entitlement.plan).toBe("plus");
  });

  it("is Free on a failed read, says so, and offers no trial it cannot vouch for", async () => {
    grantsFor.mockResolvedValue({ ok: false, error: { kind: "unavailable", message: "x" } });

    const standing = await currentBilling(LEARNER);

    expect(standing).toMatchObject({
      readable: false,
      entitlement: { plan: "free", source: "free" },
      trialEligible: false,
      hasCustomer: false,
    });
    expect(warn).toHaveBeenCalledWith("billing.entitlement_unreadable", { kind: "unavailable" });
  });

  it("is Free when the read throws, rather than taking the page down", async () => {
    grantsFor.mockRejectedValue(new Error("socket hang up"));

    const standing = await currentBilling(LEARNER);

    expect(standing.readable).toBe(false);
    expect(warn).toHaveBeenCalledWith("billing.entitlement_unreadable", { kind: "thrown" });
  });
});

describe("currentEntitlement", () => {
  it("is the standing's plan, for the routes that only need that", async () => {
    grantsFor.mockResolvedValue({ ok: true, data: grants() });

    expect(await currentEntitlement(LEARNER)).toEqual({ plan: "free", source: "free", until: null });
  });
});

describe("planForRequest", () => {
  it("is the plan the learner's rows grant, and says the rows were read", async () => {
    grantsFor.mockResolvedValue({
      ok: true,
      data: grants({ subscriptions: [subscription({ planCode: "premium" })], hasEverSubscribed: true }),
    });

    expect(await planForRequest(LEARNER)).toEqual({ plan: "premium", readable: true });
    // Read from the learner's own rows, by the id the verified session gave.
    expect(grantsFor).toHaveBeenCalledWith(LEARNER);
  });

  it("is Free when nothing grants", async () => {
    grantsFor.mockResolvedValue({ ok: true, data: grants() });

    expect(await planForRequest(LEARNER)).toEqual({ plan: "free", readable: true });
  });

  it("is Free on a failed read, and says it could not read, so nobody is upsold what they may hold", async () => {
    grantsFor.mockResolvedValue({ ok: false, error: { kind: "unavailable", message: "x" } });

    expect(await planForRequest(LEARNER)).toEqual({ plan: "free", readable: false });
  });
});
