import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockBillingProvider, type MockBillingProvider } from "@dp/billing/mock";
import { createMemoryBillingStore, type MemoryBillingStore } from "@dp/billing/testing/memory-store";
import { TRIAL_CHECKOUT_LIFETIME_SECONDS, type CheckoutSessionInput } from "@dp/billing/provider";
import type { LearnerBillingGrants } from "@dp/db/billing-repository";
import { fail, ok, repositoryError } from "@dp/db/errors";
import { createMemoryRateLimiter } from "@dp/db/rate-limit-repository";
import { TERMS_VERSION, TRIAL_DAYS } from "@dp/domain/billing";

import { openPortal, placeOrder, startTrial, type BillingOrderDeps } from "@/lib/billing/orders";

import { ALL_PRICES, priceRow } from "./fixtures";

/**
 * Placing an order, starting the trial, opening the Customer Portal.
 *
 * billing-and-plans-spec.md S6. Run against the billing package's own
 * doubles — a provider that validates exactly what Stripe would and a store
 * that keeps the SQL's promises — so what is asserted is the order of
 * events the spec requires: the order and the consent are recorded before a
 * Checkout Session exists, and a session is never opened without that record.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";
const HASH = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-10-01T12:00:00Z");
const APP = "https://deutschpartner.example";
const identity = { learnerId: LEARNER, userIdHash: HASH };

let provider: MockBillingProvider;
let store: MemoryBillingStore;
let grants: LearnerBillingGrants;
let grantsReadable: boolean;
const info = vi.fn();
const warn = vi.fn();

function deps(over: Partial<BillingOrderDeps> = {}): BillingOrderDeps {
  return {
    provider,
    admin: store,
    learner: {
      grantsFor: async () => (grantsReadable ? ok(grants) : fail(repositoryError("unavailable"))),
    },
    limiter: createMemoryRateLimiter({ limit: 5, windowMs: 60_000 }),
    trialLimiter: createMemoryRateLimiter({ limit: 3, windowMs: 86_400_000 }),
    logger: { debug: vi.fn(), info, warn, error: vi.fn() },
    now: () => NOW,
    appUrl: APP,
    automaticTax: false,
    currency: "eur",
    ...over,
  };
}

const order = (over: Record<string, unknown> = {}) => ({
  offer: "dp_plus_month",
  consent: "on",
  shownAmountMinor: "999",
  ...over,
});

const TRIALING = {
  planCode: "premium" as const,
  status: "trialing" as const,
  currentPeriodEnd: new Date("2026-10-08T12:00:00Z"),
  cancelAtPeriodEnd: true,
  trialEnd: new Date("2026-10-08T12:00:00Z"),
};

const sessionInput = () =>
  provider.calls.find((call) => call.method === "createCheckoutSession")?.input as CheckoutSessionInput | undefined;

beforeEach(async () => {
  provider = createMockBillingProvider();
  store = createMemoryBillingStore();
  await store.replacePrices(ALL_PRICES, NOW);
  grants = { customerId: null, subscriptions: [], passes: [], comps: [], hasEverSubscribed: false };
  grantsReadable = true;
  info.mockReset();
  warn.mockReset();
});

describe("placing an order", () => {
  it("records the order and the consent, then opens Checkout for it", async () => {
    const result = await placeOrder(order(), identity, deps());

    expect(result).toEqual({ ok: true, url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//) });

    const [checkout] = [...store.snapshot().checkouts.values()];
    expect(checkout).toMatchObject({ learnerId: LEARNER, offerKey: "dp_plus_month", kind: "order", status: "opened" });
    expect(checkout!.sessionId).toMatch(/^cs_/);

    // The record came first: the session carries its id.
    expect(sessionInput()?.clientReferenceId).toBe(checkout!.id);
  });

  it("creates the learner's Stripe customer once, and remembers it", async () => {
    await placeOrder(order(), identity, deps());
    await placeOrder(order({ offer: "dp_pass_plus", shownAmountMinor: "4499" }), identity, deps());

    expect(provider.calls.filter((call) => call.method === "createCustomer")).toHaveLength(1);
    expect(store.snapshot().customers.get(LEARNER)).toMatch(/^cus_/);
  });

  it("uses a customer that already exists", async () => {
    await store.saveCustomer(LEARNER, "cus_Existing1");

    await placeOrder(order(), identity, deps());

    expect(provider.calls.some((call) => call.method === "createCustomer")).toBe(false);
    expect(sessionInput()?.customerId).toBe("cus_Existing1");
  });

  it("opens a subscription for the offer's own Price, with URLs built from APP_URL", async () => {
    await placeOrder(order(), identity, deps());

    expect(sessionInput()).toMatchObject({
      priceId: priceRow("dp_plus_month").stripePriceId,
      mode: "subscription",
      trial: null,
      automaticTax: false,
      successUrl: `${APP}/billing/success?offer=dp_plus_month`,
      cancelUrl: `${APP}/billing?checkout=cancelled`,
    });
  });

  it("restates beside Stripe's button what was ordered and what it costs", async () => {
    await placeOrder(order(), identity, deps());

    const message = sessionInput()!.submitMessage;
    expect(message).toContain("Plus");
    expect(message).toContain("€9.99");
    expect(message).toMatch(/including VAT/);
    expect(message).toMatch(/renews/i);
  });

  it("opens a one-off payment for a pass, which says it does not renew", async () => {
    await placeOrder(order({ offer: "dp_pass_premium", shownAmountMinor: "4999" }), identity, deps());

    expect(sessionInput()).toMatchObject({ mode: "payment", priceId: priceRow("dp_pass_premium").stripePriceId });
    expect(sessionInput()!.submitMessage).toMatch(/90 days/);
    expect(sessionInput()!.submitMessage).not.toMatch(/renews/i);
  });

  it("passes the automatic-tax switch through", async () => {
    await placeOrder(order(), identity, deps({ automaticTax: true }));

    expect(sessionInput()?.automaticTax).toBe(true);
  });

  it("logs the order for the audit trail by pseudonym, never by id", async () => {
    await placeOrder(order(), identity, deps());

    expect(info).toHaveBeenCalledWith("billing.checkout_started", {
      audit: true,
      userIdHash: HASH,
      offer: "dp_plus_month",
      plan: "plus",
      kind: "order",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(LEARNER);
  });

  describe("refuses, and records nothing", () => {
    const nothingHappened = () => {
      expect(store.snapshot().checkouts.size).toBe(0);
      expect(provider.calls.some((call) => call.method === "createCheckoutSession")).toBe(false);
    };

    it("without the early-start consent", async () => {
      expect(await placeOrder(order({ consent: null }), identity, deps())).toEqual({
        ok: false,
        error: "consent_required",
      });
      nothingHappened();
    });

    it("for an offer that is not one of ours", async () => {
      expect(await placeOrder(order({ offer: "dp_gold_forever" }), identity, deps())).toEqual({
        ok: false,
        error: "invalid_offer",
      });
      nothingHappened();
    });

    it("when the price changed after the page was shown", async () => {
      expect(await placeOrder(order({ shownAmountMinor: "899" }), identity, deps())).toEqual({
        ok: false,
        error: "price_changed",
      });
      nothingHappened();
    });

    it("when the offer has no price in the mirror", async () => {
      await store.replacePrices([priceRow("dp_premium_month")], NOW);

      expect(await placeOrder(order(), identity, deps())).toEqual({ ok: false, error: "price_unavailable" });
      nothingHappened();
    });

    it("a second subscription for a learner who has one", async () => {
      grants = {
        ...grants,
        subscriptions: [
          { planCode: "plus", status: "active", currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEnd: null },
        ],
        hasEverSubscribed: true,
      };

      expect(await placeOrder(order({ offer: "dp_premium_month", shownAmountMinor: "1999" }), identity, deps())).toEqual({
        ok: false,
        error: "already_subscribed",
      });
      nothingHappened();
    });

    it("when the learner's billing rows cannot be read, rather than risk a second subscription", async () => {
      grantsReadable = false;

      expect(await placeOrder(order(), identity, deps())).toEqual({ ok: false, error: "unavailable" });
      nothingHappened();
    });

    it("when payments are not switched on", async () => {
      expect(await placeOrder(order(), identity, deps({ provider: null }))).toEqual({
        ok: false,
        error: "payments_off",
      });
      expect(store.snapshot().checkouts.size).toBe(0);
    });

    it("past the rate limit", async () => {
      const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
      await placeOrder(order({ consent: null }), identity, deps({ limiter }));

      expect(await placeOrder(order(), identity, deps({ limiter }))).toEqual({ ok: false, error: "rate_limited" });
      nothingHappened();
    });
  });

  it("lets a learner on the trial order a paid plan here, where the order button is", async () => {
    // A trial is not a subscription anybody pays for. Counting it as one
    // left the Customer Portal as the only way from trial to paid — past the
    // order button, the consent and the order record (spec S6).
    grants = { ...grants, customerId: "cus_Trial1", subscriptions: [TRIALING], hasEverSubscribed: true };
    await store.saveCustomer(LEARNER, "cus_Trial1");

    const result = await placeOrder(order({ offer: "dp_premium_month", shownAmountMinor: "1999" }), identity, deps());

    expect(result.ok).toBe(true);
    expect([...store.snapshot().checkouts.values()][0]).toMatchObject({ kind: "order", offerKey: "dp_premium_month" });
  });

  it("lets a subscriber buy a pass, which stacks rather than bills twice", async () => {
    grants = {
      ...grants,
      subscriptions: [
        { planCode: "plus", status: "active", currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEnd: null },
      ],
      hasEverSubscribed: true,
    };

    const result = await placeOrder(order({ offer: "dp_pass_premium", shownAmountMinor: "4999" }), identity, deps());

    expect(result.ok).toBe(true);
  });

  it("says unavailable when Stripe fails, and logs the code rather than Stripe's words", async () => {
    provider.failWith("createCheckoutSession", "stripe_unavailable");

    expect(await placeOrder(order(), identity, deps())).toEqual({ ok: false, error: "unavailable" });
    expect(warn).toHaveBeenCalledWith("billing.checkout_failed", { userIdHash: HASH, code: "stripe_unavailable" });
    // The order stays recorded, marked as one that never opened.
    expect([...store.snapshot().checkouts.values()][0]?.status).toBe("failed");
  });

  it("records the terms version and the moment of consent", async () => {
    const createCheckout = vi.spyOn(store, "createCheckout");

    await placeOrder(order(), identity, deps());

    expect(createCheckout).toHaveBeenCalledWith({
      learnerId: LEARNER,
      offerKey: "dp_plus_month",
      kind: "order",
      termsVersion: TERMS_VERSION,
      earlyStartConsentAt: NOW,
    });
  });
});

describe("starting the trial", () => {
  it("records a trial, then opens a card-free Premium subscription for it", async () => {
    const openTrialCheckout = vi.spyOn(store, "openTrialCheckout");

    const result = await startTrial(identity, deps());

    expect(result.ok).toBe(true);
    expect(openTrialCheckout).toHaveBeenCalledWith({
      learnerId: LEARNER,
      offerKey: "dp_premium_month",
      termsVersion: TERMS_VERSION,
      openForSeconds: TRIAL_CHECKOUT_LIFETIME_SECONDS,
    });
    expect(sessionInput()).toMatchObject({
      mode: "subscription",
      priceId: priceRow("dp_premium_month").stripePriceId,
      trial: { days: TRIAL_DAYS },
    });
    expect(sessionInput()!.submitMessage).toMatch(/nothing (is|will be) charged/i);
    expect(info).toHaveBeenCalledWith("billing.checkout_started", expect.objectContaining({ kind: "trial" }));
  });

  it("is one per learner, ever", async () => {
    grants = {
      ...grants,
      hasEverSubscribed: true,
      subscriptions: [{ ...TRIALING, status: "canceled", currentPeriodEnd: null }],
    };

    expect(await startTrial(identity, deps())).toEqual({ ok: false, error: "trial_used" });
    expect(store.snapshot().checkouts.size).toBe(0);
  });

  it("is not for a learner who has subscribed before — and says that, not that they had it", async () => {
    grants = {
      ...grants,
      hasEverSubscribed: true,
      subscriptions: [
        { planCode: "plus", status: "canceled", currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEnd: null },
      ],
    };

    expect(await startTrial(identity, deps())).toEqual({ ok: false, error: "trial_not_for_subscribers" });
  });

  it("opens one trial session at a time, however fast the button is pressed", async () => {
    // The webhook writes the subscription row only once a session completes,
    // so eligibility read from rows cannot stop a second session opening
    // beside the first. The order record can, under a lock.
    const [first, second] = await Promise.all([startTrial(identity, deps()), startTrial(identity, deps())]);

    expect([first, second].filter((outcome) => outcome.ok)).toHaveLength(1);
    expect([first, second]).toContainEqual({ ok: false, error: "trial_open" });
    expect(provider.calls.filter((call) => call.method === "createCheckoutSession")).toHaveLength(1);
  });

  it("is not held back by an attempt Stripe failed to open", async () => {
    provider.failWith("createCheckoutSession", "stripe_unavailable");
    expect(await startTrial(identity, deps())).toEqual({ ok: false, error: "unavailable" });

    expect((await startTrial(identity, deps())).ok).toBe(true);
  });

  it("is bounded per day, so a learner abandoning Stripe's page cannot open sessions without end", async () => {
    const trialLimiter = createMemoryRateLimiter({ limit: 1, windowMs: 86_400_000 });
    await startTrial(identity, deps({ trialLimiter }));

    expect(await startTrial(identity, deps({ trialLimiter }))).toEqual({ ok: false, error: "rate_limited" });
    expect(store.snapshot().checkouts.size).toBe(1);
  });

  it("is refused when the rows cannot be read", async () => {
    grantsReadable = false;

    expect(await startTrial(identity, deps())).toEqual({ ok: false, error: "unavailable" });
  });

  it("needs payments switched on", async () => {
    expect(await startTrial(identity, deps({ provider: null }))).toEqual({ ok: false, error: "payments_off" });
  });
});

describe("opening the Customer Portal", () => {
  it("opens it for the learner's own customer and brings them back to Plan & billing", async () => {
    await store.saveCustomer(LEARNER, "cus_Existing1");

    const result = await openPortal(identity, deps());

    expect(result).toEqual({ ok: true, url: expect.stringMatching(/^https:\/\/billing\.stripe\.com\//) });
    expect(provider.calls.find((call) => call.method === "createPortalSession")?.input).toEqual({
      customerId: "cus_Existing1",
      returnUrl: `${APP}/billing`,
    });
    expect(info).toHaveBeenCalledWith("billing.portal_opened", { audit: true, userIdHash: HASH });
  });

  it("is not opened during a trial, where a card added would outlast it", async () => {
    // The trial places no paid order. The portal is where a card is added or
    // a plan changed, both of which would turn it into a charge without the
    // order page; ordering a plan happens on the order page instead.
    await store.saveCustomer(LEARNER, "cus_Trial1");
    grants = { ...grants, customerId: "cus_Trial1", subscriptions: [TRIALING], hasEverSubscribed: true };

    expect(await openPortal(identity, deps())).toEqual({ ok: false, error: "trial_running" });
    expect(provider.calls.some((call) => call.method === "createPortalSession")).toBe(false);
  });

  it("opens for a learner on the trial who has also ordered a plan", async () => {
    await store.saveCustomer(LEARNER, "cus_Trial1");
    grants = {
      ...grants,
      customerId: "cus_Trial1",
      subscriptions: [
        TRIALING,
        { planCode: "plus", status: "active", currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEnd: null },
      ],
      hasEverSubscribed: true,
    };

    expect((await openPortal(identity, deps())).ok).toBe(true);
  });

  it("is refused when the rows cannot be read", async () => {
    await store.saveCustomer(LEARNER, "cus_Existing1");
    grantsReadable = false;

    expect(await openPortal(identity, deps())).toEqual({ ok: false, error: "unavailable" });
  });

  it("has nothing to open before a first purchase", async () => {
    expect(await openPortal(identity, deps())).toEqual({ ok: false, error: "no_customer" });
    expect(provider.calls.some((call) => call.method === "createPortalSession")).toBe(false);
  });

  it("says unavailable when Stripe fails", async () => {
    await store.saveCustomer(LEARNER, "cus_Existing1");
    provider.failWith("createPortalSession", "stripe_rate_limited");

    expect(await openPortal(identity, deps())).toEqual({ ok: false, error: "unavailable" });
  });

  it("needs payments switched on", async () => {
    expect(await openPortal(identity, deps({ provider: null }))).toEqual({ ok: false, error: "payments_off" });
  });
});
