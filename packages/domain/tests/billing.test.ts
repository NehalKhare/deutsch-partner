import { describe, expect, it } from "vitest";

import {
  BILLING_INTERVALS,
  GRANTING_SUBSCRIPTION_STATUSES,
  OFFERS,
  OFFER_KEYS,
  PASS_DAYS_MAX,
  SUBSCRIPTION_STATUSES,
  TERMS_VERSION,
  TRIAL_DAYS,
  TRIAL_PLAN,
  isGrantingStatus,
  offerFor,
  offerKeySchema,
  passDaysSchema,
  subscriptionStatusSchema,
} from "../src/billing";
import { PAID_PLAN_CODES } from "../src/plans";

describe("subscription statuses", () => {
  it("are Stripe's eight, and nothing this application invented", () => {
    expect([...SUBSCRIPTION_STATUSES].sort()).toEqual([
      "active",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "past_due",
      "paused",
      "trialing",
      "unpaid",
    ]);
    expect(subscriptionStatusSchema.safeParse("cancelled").success).toBe(false);
  });

  it("grant access only while the learner has not yet failed to pay", () => {
    // past_due is Stripe's retry window: one failed charge, not a refusal.
    expect([...GRANTING_SUBSCRIPTION_STATUSES].sort()).toEqual(["active", "past_due", "trialing"]);

    for (const status of ["incomplete", "incomplete_expired", "unpaid", "canceled", "paused"] as const) {
      expect(isGrantingStatus(status), status).toBe(false);
    }
    for (const status of GRANTING_SUBSCRIPTION_STATUSES) {
      expect(isGrantingStatus(status), status).toBe(true);
    }
  });
});

describe("offers", () => {
  it("are the six Stripe lookup keys the spec names", () => {
    expect([...OFFER_KEYS].sort()).toEqual([
      "dp_pass_plus",
      "dp_pass_premium",
      "dp_plus_month",
      "dp_plus_year",
      "dp_premium_month",
      "dp_premium_year",
    ]);
  });

  it("map each key to the plan, kind and interval it sells", () => {
    expect(OFFERS).toEqual({
      dp_plus_month: { plan: "plus", kind: "subscription", interval: "month" },
      dp_plus_year: { plan: "plus", kind: "subscription", interval: "year" },
      dp_premium_month: { plan: "premium", kind: "subscription", interval: "month" },
      dp_premium_year: { plan: "premium", kind: "subscription", interval: "year" },
      dp_pass_plus: { plan: "plus", kind: "pass", interval: null },
      dp_pass_premium: { plan: "premium", kind: "pass", interval: null },
    });
  });

  it("sells every paid plan both ways, and never sells free", () => {
    for (const plan of PAID_PLAN_CODES) {
      for (const interval of BILLING_INTERVALS) {
        expect(
          Object.values(OFFERS).some(
            (offer) => offer.plan === plan && offer.kind === "subscription" && offer.interval === interval,
          ),
          `${plan} ${interval}`,
        ).toBe(true);
      }
      expect(Object.values(OFFERS).some((offer) => offer.plan === plan && offer.kind === "pass")).toBe(true);
    }
    expect(Object.values(OFFERS).some((offer) => (offer.plan as string) === "free")).toBe(false);
  });

  it("resolves a lookup key it knows and nothing else", () => {
    expect(offerFor("dp_plus_year")).toEqual({ plan: "plus", kind: "subscription", interval: "year" });
    // A Price somebody created by hand in the Dashboard is not something to
    // grant a plan for.
    for (const unknown of ["dp_gold_month", "", null, undefined, "DP_PLUS_YEAR", "constructor", "__proto__"]) {
      expect(offerFor(unknown), String(unknown)).toBeNull();
    }
    expect(offerKeySchema.safeParse("dp_plus_week").success).toBe(false);
  });
});

describe("pass length", () => {
  it("reads Stripe metadata, which is always a string", () => {
    expect(passDaysSchema.parse("90")).toBe(90);
    expect(passDaysSchema.parse("180")).toBe(180);
    expect(passDaysSchema.parse(30)).toBe(30);
  });

  it("refuses a pass that is empty, fractional, negative or absurdly long", () => {
    for (const bad of ["", "0", "-5", "1.5", "90 days", "1e2", "731", 0, 731, 2.5, null, undefined, true]) {
      expect(passDaysSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
    expect(passDaysSchema.safeParse(String(PASS_DAYS_MAX)).success).toBe(true);
  });
});

describe("the trial and the terms", () => {
  it("offers one seven-day trial, of Premium", () => {
    expect(TRIAL_PLAN).toBe("premium");
    expect(TRIAL_DAYS).toBe(7);
  });

  it("versions the terms by date", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
