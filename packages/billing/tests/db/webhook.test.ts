import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createBillingAdminRepository,
  createLearnerBillingRepository,
} from "@dp/db/billing-repository";
import { ALICE, BOB, createTestDatabase, type TestDatabase } from "@dp/db/testing/harness";
import { createPgliteClient } from "@dp/db/testing/pglite-client";
import { resolveEntitlement } from "@dp/domain/entitlement";
import { nullLogger } from "@dp/observability/logger";

import { createMockBillingProvider, type MockBillingProvider } from "../../src/mock";
import { syncPrices } from "../../src/prices";
import type { NormalizedPrice, NormalizedSubscription, VerifiedEvent } from "../../src/provider";
import { applyBillingEvent, type BillingEventDeps } from "../../src/webhook";

/**
 * The webhook against the real repository and a real engine.
 *
 * The in-memory store keeps the SQL functions' promises by imitation; this
 * holds the webhook to the functions themselves: the claim, the upsert that
 * cannot regress, the pass granted once and revoked once, the price mirror
 * with its one-active-price constraint — and, at the end, the learner's own
 * repository reading the result under RLS and resolving the plan.
 */

let database: TestDatabase;
let provider: MockBillingProvider;

const NOW = new Date("2026-09-25T12:00:00Z");
const DAY = 86_400_000;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec(`
    delete from public.billing_events;
    delete from public.billing_prices;
    delete from public.plan_passes;
    delete from public.subscriptions;
    delete from public.billing_checkouts;
    delete from public.billing_customers;
  `);
  provider = createMockBillingProvider();
  const saved = await admin().saveCustomer(ALICE, "cus_Alice");
  if (!saved.ok) throw saved.error;
});

const admin = () => createBillingAdminRepository(createPgliteClient(database.db));

function deps(now: Date = NOW): BillingEventDeps {
  return { provider, repo: admin(), logger: nullLogger, now: () => now, pseudonymFor: () => "hash-alice" };
}

let sequence = 0;
function event(type: string, over: Partial<VerifiedEvent> = {}): VerifiedEvent {
  sequence += 1;
  return { id: `evt_Db${sequence}`, type, created: NOW, objectId: null, subscriptionId: null, ...over };
}

function subscription(over: Partial<NormalizedSubscription> = {}): NormalizedSubscription {
  return {
    id: "sub_Alice1",
    customerId: "cus_Alice",
    status: "active",
    price: { priceId: "price_PremiumMonth", lookupKey: "dp_premium_month", planCode: "premium", passDays: null },
    currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    canceledAt: null,
    ...over,
  };
}

/** What the learner app will do per request: read the learner's own rows under RLS, resolve. */
async function planOf(learnerId: string, at: Date = NOW) {
  const grants = await database.asLearner(learnerId, () =>
    createLearnerBillingRepository(createPgliteClient(database.db)).grantsFor(learnerId),
  );
  if (!grants.ok) throw grants.error;
  return resolveEntitlement({ subscriptions: grants.data.subscriptions, passes: grants.data.passes, now: at }).plan;
}

async function eventStatus(id: string) {
  const result = await database.db.query<{ status: string; error_code: string | null; attempts: number }>(
    "select status, error_code, attempts from public.billing_events where stripe_event_id = $1",
    [id],
  );
  return result.rows[0];
}

describe("a subscription's life, through the webhook", () => {
  it("grants the plan, keeps it through a failed payment, and ends it on cancellation", async () => {
    provider.setSubscription(subscription());
    const created = event("customer.subscription.created", { objectId: "sub_Alice1", subscriptionId: "sub_Alice1" });

    expect(await applyBillingEvent(created, deps())).toEqual({ outcome: "processed", httpStatus: 200 });
    expect(await planOf(ALICE)).toBe("premium");
    expect(await planOf(BOB)).toBe("free");

    provider.setSubscription(subscription({ status: "past_due" }));
    await applyBillingEvent(event("invoice.payment_failed", { objectId: "in_1", subscriptionId: "sub_Alice1" }), deps(new Date(NOW.getTime() + 1000)));
    expect(await planOf(ALICE)).toBe("premium");

    provider.setSubscription(subscription({ status: "canceled", canceledAt: NOW }));
    await applyBillingEvent(
      event("customer.subscription.deleted", { objectId: "sub_Alice1", subscriptionId: "sub_Alice1" }),
      deps(new Date(NOW.getTime() + 2000)),
    );
    expect(await planOf(ALICE)).toBe("free");
  });

  it("does not let a handler that read earlier overwrite one that read later", async () => {
    provider.setSubscription(subscription({ status: "canceled" }));
    await applyBillingEvent(
      event("customer.subscription.deleted", { objectId: "sub_Alice1", subscriptionId: "sub_Alice1" }),
      deps(new Date(NOW.getTime() + 5000)),
    );

    provider.setSubscription(subscription({ status: "active" }));
    const late = await applyBillingEvent(
      event("customer.subscription.created", { objectId: "sub_Alice1", subscriptionId: "sub_Alice1" }),
      deps(NOW),
    );

    expect(late.outcome).toBe("processed");
    expect(await planOf(ALICE)).toBe("free");
  });

  it("records a duplicate once, and a failure for Stripe to retry", async () => {
    provider.setSubscription(subscription());
    const delivered = event("customer.subscription.updated", { objectId: "sub_Alice1", subscriptionId: "sub_Alice1" });

    provider.failWith("retrieveSubscription", "stripe_unavailable");
    expect((await applyBillingEvent(delivered, deps())).httpStatus).toBe(500);
    expect(await eventStatus(delivered.id)).toEqual({ status: "failed", error_code: "stripe_unavailable", attempts: 1 });

    expect(await applyBillingEvent(delivered, deps())).toEqual({ outcome: "processed", httpStatus: 200 });
    expect(await applyBillingEvent(delivered, deps())).toEqual({ outcome: "duplicate", httpStatus: 200 });
    expect(await eventStatus(delivered.id)).toEqual({ status: "processed", error_code: null, attempts: 2 });
  });
});

describe("a pass, through the webhook", () => {
  const passSession = {
    id: "cs_test_PassDb1",
    mode: "payment",
    status: "complete",
    paymentStatus: "paid",
    customerId: "cus_Alice",
    subscriptionId: null,
    paymentIntentId: "pi_PassDb1",
    clientReferenceId: null,
    amountTotalMinor: 4999,
    currency: "eur",
    price: { priceId: "price_PassPremium", lookupKey: "dp_pass_premium", planCode: "premium", passDays: "90" },
  } as const;

  it("is granted once from two announcements, and revoked by a full refund", async () => {
    provider.setCheckoutSession(passSession);

    await applyBillingEvent(event("checkout.session.completed", { objectId: passSession.id }), deps());
    await applyBillingEvent(event("checkout.session.async_payment_succeeded", { objectId: passSession.id }), deps());

    const passes = await admin().passesFor(ALICE);
    expect(passes.ok && passes.data).toHaveLength(1);
    expect(await planOf(ALICE)).toBe("premium");
    expect(await planOf(ALICE, new Date(NOW.getTime() + 91 * DAY))).toBe("free");

    provider.setCharge({ id: "ch_PassDb1", paymentIntentId: "pi_PassDb1", refunded: true });
    expect(await applyBillingEvent(event("charge.refunded", { objectId: "ch_PassDb1" }), deps())).toEqual({
      outcome: "processed",
      httpStatus: 200,
    });
    expect(await planOf(ALICE)).toBe("free");

    // A second refund event for the same charge finds nothing left to revoke.
    expect(await applyBillingEvent(event("charge.refunded", { objectId: "ch_PassDb1" }), deps())).toEqual({
      outcome: "ignored",
      httpStatus: 200,
      code: "no_pass",
    });
  });
});

describe("the price mirror, from Stripe", () => {
  it("holds what syncPrices judged fit, and replaces a Price that took over a lookup key", async () => {
    const plusMonth: NormalizedPrice = {
      priceId: "price_PlusMonth",
      lookupKey: "dp_plus_month",
      planCode: "plus",
      passDays: null,
      currency: "eur",
      unitAmountMinor: 999,
      taxBehavior: "inclusive",
      recurring: { interval: "month", intervalCount: 1 },
    };
    provider.setPrices([plusMonth, { ...plusMonth, currency: "usd", unitAmountMinor: 1099 }]);

    const first = await syncPrices(provider, admin(), NOW);
    expect(first.ok && first.report.upserted).toBe(2);

    // A new Price takes over the key, as a price change in Stripe does. The
    // database allows one active Price per offer and currency.
    provider.setPrices([{ ...plusMonth, priceId: "price_PlusMonth2", unitAmountMinor: 1099 }]);
    const second = await syncPrices(provider, admin(), new Date(NOW.getTime() + 60_000));

    expect(second.ok && second.report).toMatchObject({ upserted: 1, deactivated: 2 });
    const active = await admin().activePrices();
    expect(active.ok && active.data.map((row) => [row.stripePriceId, row.currency, row.unitAmountMinor])).toEqual([
      ["price_PlusMonth2", "eur", 1099],
    ]);
  });

  it("still places the old Price's subscribers once its lookup key has moved on", async () => {
    const plusMonth: NormalizedPrice = {
      priceId: "price_PlusMonth",
      lookupKey: "dp_plus_month",
      planCode: "plus",
      passDays: null,
      currency: "eur",
      unitAmountMinor: 999,
      taxBehavior: "inclusive",
      recurring: { interval: "month", intervalCount: 1 },
    };
    provider.setPrices([plusMonth]);
    await syncPrices(provider, admin(), NOW);
    provider.setPrices([{ ...plusMonth, priceId: "price_PlusMonth2", unitAmountMinor: 1099 }]);
    await syncPrices(provider, admin(), new Date(NOW.getTime() + 60_000));

    // Stripe now reports the old Price with no key — and, to prove the mirror
    // is what placed it, with its metadata gone too.
    provider.setSubscription(
      subscription({ price: { priceId: "price_PlusMonth", lookupKey: null, planCode: null, passDays: null } }),
    );
    const renewal = await applyBillingEvent(
      event("invoice.paid", { objectId: "in_Db1", subscriptionId: "sub_Alice1" }),
      deps(new Date(NOW.getTime() + 120_000)),
    );

    expect(renewal).toEqual({ outcome: "processed", httpStatus: 200 });
    expect(await planOf(ALICE)).toBe("plus");
  });
});
