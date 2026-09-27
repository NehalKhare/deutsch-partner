import { beforeEach, describe, expect, it } from "vitest";

import { resolveEntitlement } from "@dp/domain/entitlement";
import type { Logger } from "@dp/observability/logger";

import { createMockBillingProvider, type MockBillingProvider } from "../src/mock";
import type { NormalizedCheckout, NormalizedSubscription, VerifiedEvent } from "../src/provider";
import { createMemoryBillingStore, type MemoryBillingStore } from "../src/testing/memory-store";
import { HANDLED_EVENT_TYPES, applyBillingEvent, type BillingEventDeps } from "../src/webhook";

/**
 * Applying a verified webhook event (billing-and-plans-spec.md S8).
 *
 * The properties that make a plan safe to sell: every event is claimed once
 * and applied idempotently; state is read fresh from Stripe, so delivery
 * order cannot regress it; a learner is found only through the customer this
 * application created; anything unrecognised grants nothing; a failure is
 * retried by Stripe rather than lost; and the log holds a pseudonym, a plan
 * and a status — never a Stripe id, a learner id or an amount.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-25T12:00:00Z");
const DAY = 86_400_000;

interface LogLine {
  readonly level: string;
  readonly event: string;
  readonly fields: Record<string, unknown>;
}

let provider: MockBillingProvider;
let store: MemoryBillingStore;
let lines: LogLine[];
let clock: Date;

function capture(): Logger {
  const push = (level: string) => (event: string, fields: Record<string, unknown> = {}) => {
    lines.push({ level, event, fields });
  };
  return { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") };
}

function deps(): BillingEventDeps {
  return {
    provider,
    repo: store,
    logger: capture(),
    now: () => clock,
    pseudonymFor: (learnerId) => `hash-${learnerId.slice(0, 8)}`,
  };
}

let sequence = 0;
function event(type: string, over: Partial<VerifiedEvent> = {}): VerifiedEvent {
  sequence += 1;
  return {
    id: `evt_${sequence}`,
    type,
    created: new Date(clock.getTime() - 1000),
    objectId: null,
    subscriptionId: null,
    ...over,
  };
}

function subscription(over: Partial<NormalizedSubscription> = {}): NormalizedSubscription {
  return {
    id: "sub_Alice1",
    customerId: "cus_Alice",
    status: "active",
    price: { priceId: "price_PlusMonth", lookupKey: "dp_plus_month", planCode: "plus", passDays: null },
    currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    canceledAt: null,
    ...over,
  };
}

function subscriptionEvent(type = "customer.subscription.updated", over: Partial<VerifiedEvent> = {}) {
  return event(type, { objectId: "sub_Alice1", subscriptionId: "sub_Alice1", ...over });
}

function subscriptionCheckout(over: Partial<NormalizedCheckout> = {}): NormalizedCheckout {
  return {
    id: "cs_test_Order1",
    mode: "subscription",
    status: "complete",
    paymentStatus: "paid",
    customerId: "cus_Alice",
    subscriptionId: "sub_Alice1",
    paymentIntentId: null,
    clientReferenceId: null,
    amountTotalMinor: 999,
    currency: "eur",
    price: { priceId: "price_PlusMonth", lookupKey: "dp_plus_month", planCode: "plus", passDays: null },
    ...over,
  };
}

function passCheckout(over: Partial<NormalizedCheckout> = {}): NormalizedCheckout {
  return subscriptionCheckout({
    id: "cs_test_Pass1",
    mode: "payment",
    subscriptionId: null,
    paymentIntentId: "pi_Pass1",
    amountTotalMinor: 4499,
    price: { priceId: "price_PassPlus", lookupKey: "dp_pass_plus", planCode: "plus", passDays: "180" },
    ...over,
  });
}

const checkoutEvent = (type: string, sessionId: string) => event(type, { objectId: sessionId });

/** A Plus monthly Price, as the price mirror holds it. */
function mirrored(stripePriceId: string) {
  return {
    stripePriceId,
    currency: "eur",
    lookupKey: "dp_plus_month" as const,
    planCode: "plus" as const,
    kind: "subscription" as const,
    interval: "month" as const,
    passDays: null,
    unitAmountMinor: 999,
    taxBehavior: "inclusive" as const,
  };
}

async function planOf(learnerId: string, at = clock) {
  const subscriptions = [...store.snapshot().subscriptions.values()].filter((row) => row.learnerId === learnerId);
  const passes = [...store.snapshot().passes.values()].filter((row) => row.learnerId === learnerId);
  return resolveEntitlement({ subscriptions, passes, now: at }).plan;
}

const eventRow = (id: string) => store.snapshot().events.get(id);

beforeEach(async () => {
  provider = createMockBillingProvider();
  store = createMemoryBillingStore();
  lines = [];
  clock = NOW;
  sequence = 0;
  await store.saveCustomer(ALICE, "cus_Alice");
  await store.saveCustomer(BOB, "cus_Bob");
});

describe("what is handled", () => {
  it("is exactly the spec's list", () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual(
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
        "invoice.paid",
        "invoice.payment_failed",
        "charge.refunded",
      ].sort(),
    );
  });

  it("records and acknowledges anything else, and grants nothing", async () => {
    const outcome = await applyBillingEvent(event("customer.updated", { objectId: "cus_Alice" }), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "unhandled_type" });
    expect(eventRow("evt_1")).toMatchObject({ status: "ignored", errorCode: "unhandled_type" });
    expect(provider.calls).toEqual([]);
  });
});

describe("subscription events", () => {
  it.each([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
  ])("%s writes the subscription as Stripe says it is now", async (type) => {
    provider.setSubscription(subscription());

    const outcome = await applyBillingEvent(subscriptionEvent(type), deps());

    expect(outcome).toEqual({ outcome: "processed", httpStatus: 200 });
    expect(provider.calls).toEqual([{ method: "retrieveSubscription", input: "sub_Alice1" }]);
    expect(store.snapshot().subscriptions.get("sub_Alice1")).toMatchObject({
      learnerId: ALICE,
      stripePriceId: "price_PlusMonth",
      planCode: "plus",
      status: "active",
      currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
      syncedAt: NOW,
    });
    expect(eventRow("evt_1")).toMatchObject({ status: "processed", errorCode: null });
    expect(await planOf(ALICE)).toBe("plus");
  });

  it("applies nothing from the event: a stale 'active' announcement cannot undo a cancellation", async () => {
    // Stripe already says canceled; the event that arrives late was about
    // the subscription when it was still active.
    provider.setSubscription(subscription({ status: "canceled", canceledAt: NOW }));

    await applyBillingEvent(subscriptionEvent("customer.subscription.created"), deps());

    expect(store.snapshot().subscriptions.get("sub_Alice1")?.status).toBe("canceled");
    expect(await planOf(ALICE)).toBe("free");
  });

  it("ends where Stripe is, whichever order two events arrive in", async () => {
    provider.setSubscription(subscription({ status: "past_due" }));
    const later = subscriptionEvent("customer.subscription.updated");
    const earlier = subscriptionEvent("customer.subscription.created", { created: new Date(NOW.getTime() - DAY) });

    await applyBillingEvent(later, deps());
    clock = new Date(NOW.getTime() + 1000);
    await applyBillingEvent(earlier, deps());

    expect(store.snapshot().subscriptions.get("sub_Alice1")?.status).toBe("past_due");
  });

  it("stamps the read before making it, so an older read can never overwrite a newer one", async () => {
    // Two handlers: the first stamps its read at NOW, the second at NOW+1s.
    // The second finishes first; the first's write must then be refused.
    provider.setSubscription(subscription({ status: "canceled" }));
    clock = new Date(NOW.getTime() + 1000);
    await applyBillingEvent(subscriptionEvent(), deps());

    provider.setSubscription(subscription({ status: "active" }));
    clock = NOW;
    const outcome = await applyBillingEvent(subscriptionEvent(), deps());

    expect(outcome.outcome).toBe("processed");
    expect(store.snapshot().subscriptions.get("sub_Alice1")?.status).toBe("canceled");
  });

  it("finds the learner only through the customer this application created", async () => {
    provider.setSubscription(subscription({ customerId: "cus_Stranger" }));

    const outcome = await applyBillingEvent(subscriptionEvent(), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "unknown_customer" });
    expect(store.snapshot().subscriptions.size).toBe(0);
  });

  it.each([
    ["a price with no lookup key, no plan and no record", null, null],
    ["a price that is not one of ours", "legacy_gold_month", "premium"],
    ["a pass's price", "dp_pass_premium", "premium"],
  ])("grants nothing for %s, and fails so Stripe retries while an operator looks", async (_label, lookupKey, planCode) => {
    provider.setSubscription(subscription({ price: { priceId: "price_Other", lookupKey, planCode, passDays: null } }));

    const outcome = await applyBillingEvent(subscriptionEvent(), deps());

    // Our customer's subscription on a Price we cannot place is a Price set
    // up wrong, not a stranger: acknowledging it would lose the event.
    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "unknown_offer" });
    expect(store.snapshot().subscriptions.size).toBe(0);
  });

  it("decides the plan by the lookup key, never by the price's metadata", async () => {
    provider.setSubscription(
      subscription({ price: { priceId: "price_PlusMonth", lookupKey: "dp_plus_month", planCode: "premium", passDays: null } }),
    );

    await applyBillingEvent(subscriptionEvent(), deps());

    expect(store.snapshot().subscriptions.get("sub_Alice1")?.planCode).toBe("plus");
  });

  describe("on a Price whose lookup key moved to a new Price", () => {
    // A price change is a new Price that takes over the lookup key; Stripe
    // removes the key from the old one, and subscribers stay on the old one.
    const orphaned = { priceId: "price_PlusMonth", lookupKey: null, planCode: null, passDays: null };

    it("follows the subscriber through the price mirror, which remembers what the Price was sold as", async () => {
      await store.replacePrices([mirrored("price_PlusMonth")], NOW);
      await store.replacePrices([mirrored("price_PlusMonth2")], NOW);
      provider.setSubscription(subscription({ price: orphaned }));

      const outcome = await applyBillingEvent(event("invoice.paid", { objectId: "in_1", subscriptionId: "sub_Alice1" }), deps());

      expect(outcome).toEqual({ outcome: "processed", httpStatus: 200 });
      expect(store.snapshot().subscriptions.get("sub_Alice1")).toMatchObject({ planCode: "plus", status: "active" });
    });

    it("records a cancellation, so a learner who stopped paying stops being granted", async () => {
      provider.setSubscription(subscription());
      await applyBillingEvent(subscriptionEvent(), deps());

      provider.setSubscription(subscription({ price: orphaned, status: "canceled", canceledAt: NOW }));
      clock = new Date(NOW.getTime() + 1000);
      const outcome = await applyBillingEvent(subscriptionEvent("customer.subscription.deleted"), deps());

      expect(outcome.outcome).toBe("processed");
      expect(store.snapshot().subscriptions.get("sub_Alice1")?.status).toBe("canceled");
      expect(await planOf(ALICE)).toBe("free");
    });

    it("keeps the stored plan while the subscription is still on the Price it was stored with", async () => {
      provider.setSubscription(subscription());
      await applyBillingEvent(subscriptionEvent(), deps());

      const renewed = new Date(NOW.getTime() + 60 * DAY);
      provider.setSubscription(subscription({ price: orphaned, currentPeriodEnd: renewed }));
      clock = new Date(NOW.getTime() + 1000);
      await applyBillingEvent(event("invoice.paid", { objectId: "in_2", subscriptionId: "sub_Alice1" }), deps());

      // The renewal is recorded; the learner does not drop to Free at the old period's end.
      expect(store.snapshot().subscriptions.get("sub_Alice1")).toMatchObject({ planCode: "plus", currentPeriodEnd: renewed });
    });

    it("reads the plan from the Price's own metadata when nothing else knows it", async () => {
      provider.setSubscription(subscription({ price: { ...orphaned, priceId: "price_Premium", planCode: "premium" } }));

      await applyBillingEvent(subscriptionEvent(), deps());

      expect(store.snapshot().subscriptions.get("sub_Alice1")?.planCode).toBe("premium");
    });

    it("does not carry a stored plan onto a different Price it cannot place", async () => {
      provider.setSubscription(subscription());
      await applyBillingEvent(subscriptionEvent(), deps());

      provider.setSubscription(subscription({ price: { ...orphaned, priceId: "price_Unplaceable" } }));
      clock = new Date(NOW.getTime() + 1000);
      const outcome = await applyBillingEvent(subscriptionEvent(), deps());

      expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "unknown_offer" });
    });
  });

  it("fails, for Stripe to retry, on a status it does not know", async () => {
    provider.setSubscription(subscription({ status: "suspended" }));

    const outcome = await applyBillingEvent(subscriptionEvent(), deps());

    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "unknown_status" });
    expect(store.snapshot().subscriptions.size).toBe(0);
    expect(eventRow("evt_1")).toMatchObject({ status: "failed", errorCode: "unknown_status" });
  });

  it("refuses to move a subscription to another learner", async () => {
    provider.setSubscription(subscription());
    await applyBillingEvent(subscriptionEvent(), deps());

    provider.setSubscription(subscription({ customerId: "cus_Bob" }));
    const outcome = await applyBillingEvent(subscriptionEvent(), deps());

    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "store_forbidden" });
    expect(store.snapshot().subscriptions.get("sub_Alice1")?.learnerId).toBe(ALICE);
  });

  it("ignores a subscription event with nothing to look up", async () => {
    const outcome = await applyBillingEvent(
      event("customer.subscription.updated", { objectId: null, subscriptionId: null }),
      deps(),
    );

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "missing_object" });
  });
});

describe("invoice events", () => {
  it.each(["invoice.paid", "invoice.payment_failed"])("%s re-reads the subscription the invoice bills", async (type) => {
    provider.setSubscription(subscription({ status: type === "invoice.paid" ? "active" : "past_due" }));

    const outcome = await applyBillingEvent(event(type, { objectId: "in_1", subscriptionId: "sub_Alice1" }), deps());

    expect(outcome.outcome).toBe("processed");
    expect(provider.calls).toEqual([{ method: "retrieveSubscription", input: "sub_Alice1" }]);
    // past_due is Stripe's retry window, and still grants.
    expect(await planOf(ALICE)).toBe("plus");
  });

  it("acknowledges an invoice that bills no subscription — a pass's receipt", async () => {
    const outcome = await applyBillingEvent(event("invoice.paid", { objectId: "in_2", subscriptionId: null }), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "not_a_subscription" });
    expect(provider.calls).toEqual([]);
  });
});

describe("a trial", () => {
  const trialing = (over: Partial<NormalizedSubscription> = {}) =>
    subscription({
      status: "trialing",
      trialEnd: new Date(NOW.getTime() + 7 * DAY),
      currentPeriodEnd: new Date(NOW.getTime() + 7 * DAY),
      price: { priceId: "price_PremiumMonth", lookupKey: "dp_premium_month", planCode: "premium", passDays: null },
      ...over,
    });

  it("is set to end at its end, so a card added later cannot turn it into a charge", async () => {
    // The trial places no paid order (spec S6). missing_payment_method=cancel
    // only acts when no card exists; cancelling at the period end holds
    // whatever the Customer Portal was used for in between.
    provider.setSubscription(trialing());

    const outcome = await applyBillingEvent(subscriptionEvent("customer.subscription.created"), deps());

    expect(outcome.outcome).toBe("processed");
    expect(provider.calls.map((call) => call.method)).toEqual(["retrieveSubscription", "cancelAtPeriodEnd"]);
    expect(store.snapshot().subscriptions.get("sub_Alice1")).toMatchObject({ status: "trialing", cancelAtPeriodEnd: true });
    expect(lines.some((line) => line.event === "billing.trial_capped" && line.fields.audit === true)).toBe(true);
  });

  it("is set to end again if someone switched that off", async () => {
    provider.setSubscription(trialing({ cancelAtPeriodEnd: true }));
    await applyBillingEvent(subscriptionEvent(), deps());
    expect(provider.calls.map((call) => call.method)).toEqual(["retrieveSubscription"]);

    provider.setSubscription(trialing({ cancelAtPeriodEnd: false }));
    clock = new Date(NOW.getTime() + 1000);
    await applyBillingEvent(subscriptionEvent(), deps());

    expect(provider.calls.map((call) => call.method)).toContain("cancelAtPeriodEnd");
    expect(store.snapshot().subscriptions.get("sub_Alice1")?.cancelAtPeriodEnd).toBe(true);
  });

  it("is left alone when it belongs to a customer this application never created", async () => {
    provider.setSubscription(trialing({ customerId: "cus_Stranger" }));

    await applyBillingEvent(subscriptionEvent(), deps());

    expect(provider.calls.map((call) => call.method)).toEqual(["retrieveSubscription"]);
  });

  it("fails for Stripe to retry when it cannot be set to end, and grants nothing yet", async () => {
    provider.setSubscription(trialing());
    provider.failWith("cancelAtPeriodEnd", "stripe_unavailable");

    const outcome = await applyBillingEvent(subscriptionEvent(), deps());

    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "stripe_unavailable" });
    expect(store.snapshot().subscriptions.size).toBe(0);
  });
});

describe("an expired Checkout Session", () => {
  it("marks its order expired, and grants nothing", async () => {
    const opened = await store.openTrialCheckout({
      learnerId: ALICE,
      offerKey: "dp_premium_month",
      termsVersion: "2026-09-25",
      openForSeconds: 1800,
    });
    if (!opened.ok || opened.data.status !== "created") throw new Error("no trial checkout");
    await store.attachCheckoutSession(opened.data.id, "cs_test_Trial1");

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.expired", "cs_test_Trial1"), deps());

    expect(outcome).toEqual({ outcome: "processed", httpStatus: 200 });
    expect(store.snapshot().checkouts.get(opened.data.id)?.status).toBe("expired");
    expect(provider.calls).toEqual([]);
  });
});

describe("a completed subscription checkout", () => {
  it("writes the subscription and marks the order completed", async () => {
    const checkoutId = await store.createCheckout({
      learnerId: ALICE,
      offerKey: "dp_plus_month",
      kind: "order",
      termsVersion: "2026-09-25",
      earlyStartConsentAt: NOW,
    });
    if (!checkoutId.ok) throw checkoutId.error;
    await store.attachCheckoutSession(checkoutId.data, "cs_test_Order1");
    provider.setCheckoutSession(subscriptionCheckout());
    provider.setSubscription(subscription());

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Order1"), deps());

    expect(outcome.outcome).toBe("processed");
    expect(store.snapshot().subscriptions.get("sub_Alice1")?.planCode).toBe("plus");
    expect(store.snapshot().checkouts.get(checkoutId.data)?.status).toBe("completed");
  });

  it("starts the trial it was opened for", async () => {
    provider.setCheckoutSession(
      subscriptionCheckout({
        paymentStatus: "no_payment_required",
        amountTotalMinor: 0,
        price: { priceId: "price_PremiumMonth", lookupKey: "dp_premium_month", planCode: "premium", passDays: null },
      }),
    );
    provider.setSubscription(
      subscription({
        status: "trialing",
        trialEnd: new Date(NOW.getTime() + 7 * DAY),
        currentPeriodEnd: new Date(NOW.getTime() + 7 * DAY),
        price: { priceId: "price_PremiumMonth", lookupKey: "dp_premium_month", planCode: "premium", passDays: null },
      }),
    );

    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Order1"), deps());

    expect(await planOf(ALICE)).toBe("premium");
  });

  it("still grants when no order row carries the session, and says so", async () => {
    provider.setCheckoutSession(subscriptionCheckout());
    provider.setSubscription(subscription());

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Order1"), deps());

    // The customer mapping is the key; the order row is corroboration.
    expect(outcome.outcome).toBe("processed");
    expect(await planOf(ALICE)).toBe("plus");
    expect(lines.some((line) => line.event === "billing.checkout_unmatched" && line.level === "warn")).toBe(true);
  });

  it("finds the learner by the session's customer, not by its reference", async () => {
    provider.setCheckoutSession(subscriptionCheckout({ customerId: "cus_Stranger", clientReferenceId: ALICE }));

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Order1"), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "unknown_customer" });
    expect(store.snapshot().subscriptions.size).toBe(0);
  });
});

describe("a pass bought through Checkout", () => {
  it("is granted from now for its days, at what was paid", async () => {
    provider.setCheckoutSession(passCheckout());

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(outcome.outcome).toBe("processed");
    const pass = store.snapshot().passes.get("cs_test_Pass1");
    expect(pass).toMatchObject({
      learnerId: ALICE,
      planCode: "plus",
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + 180 * DAY),
      stripePaymentIntentId: "pi_Pass1",
      amountMinor: 4499,
      currency: "eur",
    });
    expect(await planOf(ALICE)).toBe("plus");
    expect(await planOf(ALICE, new Date(NOW.getTime() + 181 * DAY))).toBe("free");
  });

  it("stacks after a pass of the same plan instead of overlapping it", async () => {
    await store.grantPass({
      learnerId: ALICE,
      planCode: "plus",
      days: 180,
      at: new Date(NOW.getTime() - 120 * DAY),
      stripeCheckoutSessionId: "cs_test_Earlier",
      stripePaymentIntentId: "pi_Earlier",
      amountMinor: 4499,
      currency: "eur",
    });
    provider.setCheckoutSession(passCheckout());

    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(store.snapshot().passes.get("cs_test_Pass1")).toMatchObject({
      startsAt: new Date(NOW.getTime() + 60 * DAY),
      endsAt: new Date(NOW.getTime() + 240 * DAY),
    });
  });

  it("starts now beside a pass of another plan, where the higher plan wins while both run", async () => {
    await store.grantPass({
      learnerId: ALICE,
      planCode: "premium",
      days: 90,
      at: NOW,
      stripeCheckoutSessionId: "cs_test_Premium",
      stripePaymentIntentId: "pi_Premium",
      amountMinor: 4999,
      currency: "eur",
    });
    provider.setCheckoutSession(passCheckout());

    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(store.snapshot().passes.get("cs_test_Pass1")?.startsAt).toEqual(NOW);
    expect(await planOf(ALICE)).toBe("premium");
  });

  it("is granted once, and audited once, however many events announce it", async () => {
    provider.setCheckoutSession(passCheckout());

    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());
    clock = new Date(NOW.getTime() + 60_000);
    await applyBillingEvent(checkoutEvent("checkout.session.async_payment_succeeded", "cs_test_Pass1"), deps());

    expect([...store.snapshot().passes.values()].filter((pass) => pass.learnerId === ALICE)).toHaveLength(1);
    expect(store.snapshot().passes.get("cs_test_Pass1")?.startsAt).toEqual(NOW);
    expect(lines.filter((line) => line.event === "billing.pass_granted")).toHaveLength(1);
  });

  it("waits for a delayed payment method, then grants when it pays", async () => {
    provider.setCheckoutSession(passCheckout({ paymentStatus: "unpaid" }));

    const pending = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(pending.outcome).toBe("processed");
    expect(store.snapshot().passes.size).toBe(0);

    provider.setCheckoutSession(passCheckout({ paymentStatus: "paid" }));
    await applyBillingEvent(checkoutEvent("checkout.session.async_payment_succeeded", "cs_test_Pass1"), deps());

    expect(await planOf(ALICE)).toBe("plus");
  });

  it("marks the order failed when a delayed payment fails, and grants nothing", async () => {
    const checkoutId = await store.createCheckout({
      learnerId: ALICE,
      offerKey: "dp_pass_plus",
      kind: "order",
      termsVersion: "2026-09-25",
      earlyStartConsentAt: NOW,
    });
    if (!checkoutId.ok) throw checkoutId.error;
    await store.attachCheckoutSession(checkoutId.data, "cs_test_Pass1");
    provider.setCheckoutSession(passCheckout({ paymentStatus: "unpaid" }));

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.async_payment_failed", "cs_test_Pass1"), deps());

    expect(outcome.outcome).toBe("processed");
    expect(store.snapshot().checkouts.get(checkoutId.data)?.status).toBe("failed");
    expect(store.snapshot().passes.size).toBe(0);
  });

  it("is granted for a free order a promotion code paid for in full", async () => {
    provider.setCheckoutSession(passCheckout({ paymentStatus: "no_payment_required", paymentIntentId: null, amountTotalMinor: 0 }));

    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(store.snapshot().passes.get("cs_test_Pass1")).toMatchObject({ amountMinor: 0, stripePaymentIntentId: null });
  });

  it.each([
    ["no length", null],
    ["a length with a unit", "180d"],
    ["a length of nothing", "0"],
    ["a length past the longest", "731"],
  ])("fails, for Stripe to retry once the Price is fixed, on a pass with %s", async (_label, passDays) => {
    provider.setCheckoutSession(
      passCheckout({ price: { priceId: "price_PassPlus", lookupKey: "dp_pass_plus", planCode: "plus", passDays } }),
    );

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "invalid_pass_days" });
    expect(store.snapshot().passes.size).toBe(0);
  });

  it("is granted when its Price lost its lookup key between checkout and payment", async () => {
    // A SEPA pass completes days after checkout; the key may have moved on by then.
    await store.replacePrices(
      [{ ...mirrored("price_PassPlus"), lookupKey: "dp_pass_plus", kind: "pass", interval: null, passDays: 180, unitAmountMinor: 4499 }],
      NOW,
    );
    provider.setCheckoutSession(
      passCheckout({ price: { priceId: "price_PassPlus", lookupKey: null, planCode: null, passDays: null } }),
    );

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.async_payment_succeeded", "cs_test_Pass1"), deps());

    expect(outcome.outcome).toBe("processed");
    expect(store.snapshot().passes.get("cs_test_Pass1")).toMatchObject({
      planCode: "plus",
      endsAt: new Date(NOW.getTime() + 180 * DAY),
    });
  });

  it("fails, for Stripe to retry, when a paid pass's Price cannot be placed at all", async () => {
    provider.setCheckoutSession(
      passCheckout({ price: { priceId: "price_Nowhere", lookupKey: null, planCode: null, passDays: "180" } }),
    );

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    // Paid for and not yet granted: acknowledging it would lose the purchase.
    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "unknown_offer" });
  });

  it("grants nothing when the paid price is a subscription's", async () => {
    provider.setCheckoutSession(
      passCheckout({ price: { priceId: "price_PlusMonth", lookupKey: "dp_plus_month", planCode: "plus", passDays: "180" } }),
    );

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "unknown_offer" });
    expect(store.snapshot().passes.size).toBe(0);
  });

  it("grants nothing for a session that is not complete", async () => {
    provider.setCheckoutSession(passCheckout({ status: "open" }));

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(outcome.outcome).toBe("processed");
    expect(store.snapshot().passes.size).toBe(0);
  });

  it("ignores a Checkout mode this application never opens", async () => {
    provider.setCheckoutSession(passCheckout({ mode: "setup" }));

    const outcome = await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "unsupported_mode" });
  });
});

describe("a refund", () => {
  beforeEach(async () => {
    provider.setCheckoutSession(passCheckout());
    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());
  });

  it("in full revokes the pass it paid for", async () => {
    provider.setCharge({ id: "ch_Pass1", paymentIntentId: "pi_Pass1", refunded: true });

    const outcome = await applyBillingEvent(event("charge.refunded", { objectId: "ch_Pass1" }), deps());

    expect(outcome.outcome).toBe("processed");
    expect(store.snapshot().passes.get("cs_test_Pass1")?.revokedAt).toEqual(NOW);
    expect(await planOf(ALICE)).toBe("free");
    expect(lines.some((line) => line.event === "billing.pass_revoked" && line.fields.audit === true)).toBe(true);
  });

  it("in full brings a pass stacked behind the refunded one forward", async () => {
    provider.setCheckoutSession(passCheckout({ id: "cs_test_Pass2", paymentIntentId: "pi_Pass2" }));
    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass2"), deps());
    expect(store.snapshot().passes.get("cs_test_Pass2")?.startsAt).toEqual(new Date(NOW.getTime() + 180 * DAY));

    clock = new Date(NOW.getTime() + 10 * DAY);
    provider.setCharge({ id: "ch_Pass1", paymentIntentId: "pi_Pass1", refunded: true });
    await applyBillingEvent(event("charge.refunded", { objectId: "ch_Pass1" }), deps());

    expect(store.snapshot().passes.get("cs_test_Pass2")?.startsAt).toEqual(clock);
    expect(await planOf(ALICE)).toBe("plus");
  });

  it("in part leaves the pass alone", async () => {
    provider.setCharge({ id: "ch_Pass1", paymentIntentId: "pi_Pass1", refunded: false });

    const outcome = await applyBillingEvent(event("charge.refunded", { objectId: "ch_Pass1" }), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "partial_refund" });
    expect(await planOf(ALICE)).toBe("plus");
  });

  it("of a subscription's charge touches no pass: the subscription's own events carry that", async () => {
    provider.setCharge({ id: "ch_Sub1", paymentIntentId: "pi_Subscription", refunded: true });

    const outcome = await applyBillingEvent(event("charge.refunded", { objectId: "ch_Sub1" }), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "no_pass" });
    expect(await planOf(ALICE)).toBe("plus");
  });

  it("with no payment behind it revokes nothing", async () => {
    provider.setCharge({ id: "ch_Odd", paymentIntentId: null, refunded: true });

    const outcome = await applyBillingEvent(event("charge.refunded", { objectId: "ch_Odd" }), deps());

    expect(outcome).toEqual({ outcome: "ignored", httpStatus: 200, code: "no_payment_intent" });
  });
});

describe("the inbox", () => {
  it("acknowledges a processed event's redelivery and does nothing else", async () => {
    provider.setSubscription(subscription());
    const delivered = subscriptionEvent();

    await applyBillingEvent(delivered, deps());
    const again = await applyBillingEvent(delivered, deps());

    expect(again).toEqual({ outcome: "duplicate", httpStatus: 200 });
    expect(provider.calls).toHaveLength(1);
    expect(eventRow(delivered.id)?.attempts).toBe(1);
  });

  it("acknowledges an ignored event's redelivery too", async () => {
    const delivered = event("customer.updated");

    await applyBillingEvent(delivered, deps());

    expect(await applyBillingEvent(delivered, deps())).toEqual({ outcome: "duplicate", httpStatus: 200 });
  });

  it("returns 500 on a Stripe failure, so Stripe's retry schedule is the queue", async () => {
    provider.setSubscription(subscription());
    provider.failWith("retrieveSubscription", "stripe_unavailable");
    const delivered = subscriptionEvent();

    const first = await applyBillingEvent(delivered, deps());

    expect(first).toEqual({ outcome: "failed", httpStatus: 500, code: "stripe_unavailable" });
    expect(eventRow(delivered.id)).toMatchObject({ status: "failed", errorCode: "stripe_unavailable" });
    expect(lines.some((line) => line.event === "billing.event_failed" && line.fields.audit === true)).toBe(true);

    const retried = await applyBillingEvent(delivered, deps());

    expect(retried).toEqual({ outcome: "processed", httpStatus: 200 });
    expect(eventRow(delivered.id)).toMatchObject({ status: "processed", errorCode: null, attempts: 2 });
    expect(await planOf(ALICE)).toBe("plus");
  });

  it("returns 500 without applying anything when the event cannot be claimed", async () => {
    store.failWith("claimEvent", "unavailable");
    provider.setSubscription(subscription());

    const outcome = await applyBillingEvent(subscriptionEvent(), deps());

    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "store_unavailable" });
    expect(provider.calls).toEqual([]);
  });

  it("returns 500 when a store write fails, and succeeds on the retry", async () => {
    store.failWith("upsertSubscription", "unavailable");
    provider.setSubscription(subscription());
    const delivered = subscriptionEvent();

    expect(await applyBillingEvent(delivered, deps())).toEqual({ outcome: "failed", httpStatus: 500, code: "store_unavailable" });
    expect(await applyBillingEvent(delivered, deps())).toEqual({ outcome: "processed", httpStatus: 200 });
  });

  it("returns 500 when the outcome cannot be recorded, so the work is redone rather than forgotten", async () => {
    store.failWith("finishEvent", "unavailable");
    provider.setSubscription(subscription());
    const delivered = subscriptionEvent();

    expect((await applyBillingEvent(delivered, deps())).httpStatus).toBe(500);
    expect(eventRow(delivered.id)?.status).toBe("received");

    expect(await applyBillingEvent(delivered, deps())).toEqual({ outcome: "processed", httpStatus: 200 });
  });

  it("turns a thrown surprise into a failure with a code, not a crash", async () => {
    provider.setSubscription(subscription());
    const failing = {
      ...deps(),
      provider: {
        ...provider,
        retrieveSubscription: async () => {
          throw new Error("something with alice@example.com in it");
        },
      },
    };

    const outcome = await applyBillingEvent(subscriptionEvent(), failing);

    expect(outcome).toEqual({ outcome: "failed", httpStatus: 500, code: "unexpected" });
    expect(JSON.stringify(lines)).not.toContain("alice@example.com");
  });
});

describe("the log", () => {
  it("audits a change of plan or status with the pseudonym, never an id", async () => {
    provider.setSubscription(subscription({ status: "trialing" }));
    await applyBillingEvent(subscriptionEvent(), deps());
    provider.setSubscription(subscription({ status: "active" }));
    await applyBillingEvent(subscriptionEvent(), deps());

    const changes = lines.filter((line) => line.event === "billing.subscription_changed");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      level: "info",
      fields: { audit: true, userIdHash: "hash-11111111", fromPlan: null, toPlan: "plus", fromStatus: null, toStatus: "trialing" },
    });
    expect(changes[1]).toMatchObject({
      fields: { fromPlan: "plus", toPlan: "plus", fromStatus: "trialing", toStatus: "active" },
    });
  });

  it("does not audit a re-read that changed nothing", async () => {
    provider.setSubscription(subscription());
    await applyBillingEvent(subscriptionEvent(), deps());
    await applyBillingEvent(subscriptionEvent(), deps());

    expect(lines.filter((line) => line.event === "billing.subscription_changed")).toHaveLength(1);
  });

  it("names no Stripe object, no learner id and no amount in any line", async () => {
    provider.setSubscription(subscription());
    provider.setCheckoutSession(passCheckout());
    provider.setCharge({ id: "ch_Pass1", paymentIntentId: "pi_Pass1", refunded: true });

    await applyBillingEvent(subscriptionEvent(), deps());
    await applyBillingEvent(checkoutEvent("checkout.session.completed", "cs_test_Pass1"), deps());
    await applyBillingEvent(event("charge.refunded", { objectId: "ch_Pass1" }), deps());
    await applyBillingEvent(event("customer.updated"), deps());

    const serialised = JSON.stringify(lines);
    expect(lines.length).toBeGreaterThan(0);
    for (const forbidden of ["sub_", "cus_", "cs_test", "pi_", "ch_", "price_", ALICE, "4499"]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    // What a payment is followed by: the event, its type, the outcome, the plan, the pseudonym.
    expect(lines.every((line) => typeof line.fields.eventId === "string" && typeof line.fields.eventType === "string")).toBe(true);
  });
});
