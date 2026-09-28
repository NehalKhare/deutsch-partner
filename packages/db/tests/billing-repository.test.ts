import { describe, expect, it } from "vitest";

import { createFakeSupabase } from "@dp/test-support/fake-supabase";

import {
  billingPriceInputSchema,
  createBillingAdminRepository,
  createLearnerBillingRepository,
} from "../src/billing-repository";

/**
 * The billing repositories' contract with the wire: what they send, what they
 * refuse before sending anything, and what a failure looks like to a caller.
 * What the database does with it is tests/db/billing.test.ts.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-25T12:00:00Z");

describe("the admin repository's writes", () => {
  it("sends a subscription as the row the function populates, dates as ISO strings", async () => {
    const fake = createFakeSupabase({});
    await createBillingAdminRepository(fake.client).upsertSubscription({
      learnerId: LEARNER,
      stripeSubscriptionId: "sub_A1",
      stripePriceId: "price_A1",
      planCode: "premium",
      status: "trialing",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      trialEnd: NOW,
      canceledAt: null,
      syncedAt: NOW,
    });

    expect(fake.rpcCalls).toEqual([
      {
        fn: "billing_upsert_subscription",
        args: {
          p_subscription: {
            learner_id: LEARNER,
            stripe_subscription_id: "sub_A1",
            stripe_price_id: "price_A1",
            plan_code: "premium",
            status: "trialing",
            current_period_end: null,
            cancel_at_period_end: true,
            trial_end: "2026-09-25T12:00:00.000Z",
            canceled_at: null,
            stripe_synced_at: "2026-09-25T12:00:00.000Z",
          },
        },
      },
    ]);
  });

  it.each([
    ["a customer id that is not Stripe's", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.saveCustomer(LEARNER, "alice@example.com")],
    ["a learner id that is not an id", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.customerFor("alice")],
    ["the free plan as a subscription", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.upsertSubscription({
        learnerId: LEARNER,
        stripeSubscriptionId: "sub_A1",
        stripePriceId: "price_A1",
        planCode: "free" as never,
        status: "active",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        canceledAt: null,
        syncedAt: NOW,
      })],
    ["a pass of no days", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.grantPass({
        learnerId: LEARNER,
        planCode: "plus",
        days: 0,
        at: NOW,
        stripeCheckoutSessionId: "cs_test_A",
        stripePaymentIntentId: null,
        amountMinor: 4499,
        currency: "eur",
      })],
    ["a pass longer than any sold", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.grantPass({
        learnerId: LEARNER,
        planCode: "plus",
        days: 731,
        at: NOW,
        stripeCheckoutSessionId: "cs_test_A",
        stripePaymentIntentId: null,
        amountMinor: 4499,
        currency: "eur",
      })],
    ["a trial of Plus", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.openTrialCheckout({
        learnerId: LEARNER,
        offerKey: "dp_plus_month",
        termsVersion: "2026-09-25",
        openForSeconds: 1800,
      })],
    ["a trial recorded as if it were an order", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.createCheckout({
        learnerId: LEARNER,
        offerKey: "dp_premium_month",
        kind: "trial" as never,
        termsVersion: "2026-09-25",
        earlyStartConsentAt: null,
      })],
    ["a failure with no code", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.finishEvent("evt_A", "failed", null)],
    ["an event id that is not Stripe's", (repo: ReturnType<typeof createBillingAdminRepository>) =>
      repo.claimEvent({ eventId: "12345", type: "invoice.paid", createdAt: NOW })],
    ["the same price twice in one sync", (repo: ReturnType<typeof createBillingAdminRepository>) => {
      const row = {
        stripePriceId: "price_A1",
        currency: "eur",
        lookupKey: "dp_plus_month" as const,
        planCode: "plus" as const,
        kind: "subscription" as const,
        interval: "month" as const,
        passDays: null,
        unitAmountMinor: 999,
        taxBehavior: "inclusive" as const,
      };
      return repo.replacePrices([row, row], NOW);
    }],
  ])("refuses %s before any query", async (_label, act) => {
    const fake = createFakeSupabase({});

    const result = await act(createBillingAdminRepository(fake.client));

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("sends a pass as its length and when it was paid, leaving the window to the database", async () => {
    const fake = createFakeSupabase({});
    await createBillingAdminRepository(fake.client).grantPass({
      learnerId: LEARNER,
      planCode: "premium",
      days: 90,
      at: NOW,
      stripeCheckoutSessionId: "cs_test_A",
      stripePaymentIntentId: "pi_A",
      amountMinor: 4999,
      currency: "eur",
    });

    expect(fake.rpcCalls).toEqual([
      {
        fn: "billing_grant_pass",
        args: {
          p_pass: {
            learner_id: LEARNER,
            plan_code: "premium",
            pass_days: 90,
            at: "2026-09-25T12:00:00.000Z",
            stripe_checkout_session_id: "cs_test_A",
            stripe_payment_intent_id: "pi_A",
            amount_minor: 4999,
            currency: "eur",
          },
        },
      },
    ]);
  });

  it("reports a database failure as a safe kind, never with the driver's words", async () => {
    const fake = createFakeSupabase({
      billing_customers: {
        error: { code: "23505", message: 'duplicate key value violates "cus_Secret" for alice@example.com' },
      },
    });

    const result = await createBillingAdminRepository(fake.client).saveCustomer(LEARNER, "cus_A1");

    expect(result).toMatchObject({ ok: false, error: { kind: "conflict" } });
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
  });

  it("finishes a processed event with the time it finished, and a failed one with none", async () => {
    const fake = createFakeSupabase({ billing_events: { data: [{ stripe_event_id: "evt_A" }] } });
    const repo = createBillingAdminRepository(fake.client);

    await repo.finishEvent("evt_A", "processed", null, NOW);
    expect(fake.methodArgs("billing_events", "update")).toEqual([
      [{ status: "processed", error_code: null, processed_at: "2026-09-25T12:00:00.000Z" }],
    ]);

    await repo.finishEvent("evt_A", "failed", "stripe_unavailable", NOW);
    expect(fake.methodArgs("billing_events", "update")).toEqual([
      [{ status: "failed", error_code: "stripe_unavailable", processed_at: null }],
    ]);
  });
});

describe("the learner's repository", () => {
  it("asks for the columns entitlement needs, filtered to the learner", async () => {
    const fake = createFakeSupabase({
      subscriptions: { data: [] },
      plan_passes: { data: [] },
      plan_comps: { data: [] },
    });

    const result = await createLearnerBillingRepository(fake.client).grantsFor(LEARNER);

    expect(result).toEqual({
      ok: true,
      data: { customerId: null, subscriptions: [], passes: [], comps: [], hasEverSubscribed: false },
    });
    expect(fake.methodArgs("subscriptions", "select")).toEqual([
      ["plan_code, status, current_period_end, cancel_at_period_end, trial_end"],
    ]);
    expect(fake.methodArgs("plan_passes", "eq")).toEqual([["learner_id", LEARNER]]);
    expect(fake.methodArgs("plan_comps", "eq")).toEqual([["learner_id", LEARNER]]);
  });

  it("fails the read when a row is malformed rather than dropping it", async () => {
    // A subscription row entitlement cannot read must not quietly become "free".
    const fake = createFakeSupabase({
      subscriptions: { data: [{ plan_code: "gold", status: "active", current_period_end: null, cancel_at_period_end: false, trial_end: null }] },
      plan_passes: { data: [] },
      plan_comps: { data: [] },
    });

    const result = await createLearnerBillingRepository(fake.client).grantsFor(LEARNER);

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_data" } });
  });
});

describe("a price from Stripe", () => {
  const base = {
    stripePriceId: "price_A1",
    currency: "eur",
    lookupKey: "dp_premium_year",
    planCode: "premium",
    kind: "subscription",
    interval: "year",
    passDays: null,
    unitAmountMinor: 13999,
    taxBehavior: "inclusive",
  };

  it("parses when it matches the offer its lookup key names", () => {
    expect(billingPriceInputSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    ["the wrong plan for its key", { planCode: "plus" }],
    ["the wrong interval for its key", { interval: "month" }],
    ["a subscription with a length", { passDays: 30 }],
    ["a fractional amount", { unitAmountMinor: 139.99 }],
    ["an upper-case currency", { currency: "EUR" }],
  ])("is refused with %s", (_label, over) => {
    expect(billingPriceInputSchema.safeParse({ ...base, ...over }).success).toBe(false);
  });

  it("is a pass only with a length", () => {
    const pass = { ...base, lookupKey: "dp_pass_premium", kind: "pass", interval: null };

    expect(billingPriceInputSchema.safeParse({ ...pass, passDays: 90 }).success).toBe(true);
    expect(billingPriceInputSchema.safeParse(pass).success).toBe(false);
  });
});
