import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZodObject } from "zod";

import {
  billingCheckoutRowSchema,
  billingCustomerRowSchema,
  billingPriceRowSchema,
  createBillingAdminRepository,
  createLearnerBillingRepository,
  planPassRowSchema,
  subscriptionRowSchema,
  type BillingPriceInput,
  type NewPass,
  type SubscriptionRecord,
} from "../../src/billing-repository";
import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";
import { createPgliteClient } from "../../src/testing/pglite-client";

/**
 * Plans and payments, against a real engine.
 *
 * What only Postgres can confirm: that the shapes Stripe hands over are held
 * to their formats below the application, that an order row cannot exist
 * without the consent it records, that the webhook's writes are idempotent
 * and cannot regress (a duplicate claim, a stale subscription read, a second
 * refund), and that the learner's repository — running under RLS — sees their
 * own grants and nobody else's.
 */

let database: TestDatabase;

const NOW = new Date("2026-09-25T12:00:00Z");
const LATER = new Date("2026-09-25T12:05:00Z");
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
});

const admin = () => createBillingAdminRepository(createPgliteClient(database.db));
const learnerRepo = () => createLearnerBillingRepository(createPgliteClient(database.db));

async function refusal(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function call<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await database.db.query<{ result: T }>(`select ${sql} as result`, params);
  return result.rows[0].result;
}

function subscription(over: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    learnerId: ALICE,
    stripeSubscriptionId: "sub_Alice1",
    stripePriceId: "price_PlusMonth",
    planCode: "plus",
    status: "active",
    currentPeriodEnd: new Date("2026-10-25T12:00:00Z"),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    canceledAt: null,
    syncedAt: NOW,
    ...over,
  };
}

function pass(over: Partial<NewPass> = {}): NewPass {
  return {
    learnerId: ALICE,
    planCode: "plus",
    // 180 days from NOW end on 2027-03-24T12:00:00Z.
    days: 180,
    at: NOW,
    stripeCheckoutSessionId: "cs_test_Pass1",
    stripePaymentIntentId: "pi_Pass1",
    amountMinor: 4499,
    currency: "eur",
    ...over,
  };
}

function price(over: Partial<BillingPriceInput> = {}): BillingPriceInput {
  return {
    stripePriceId: "price_PlusMonth",
    currency: "eur",
    lookupKey: "dp_plus_month",
    planCode: "plus",
    kind: "subscription",
    interval: "month",
    passDays: null,
    unitAmountMinor: 999,
    taxBehavior: "inclusive",
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("what the tables refuse", () => {
  it.each([
    [`insert into public.billing_customers (learner_id, stripe_customer_id) values ('${ALICE}', 'alice@example.com')`],
    [`insert into public.subscriptions (learner_id, stripe_subscription_id, stripe_price_id, plan_code, status, stripe_synced_at)
      values ('${ALICE}', 'sub_A', 'price_A', 'free', 'active', now())`],
    [`insert into public.subscriptions (learner_id, stripe_subscription_id, stripe_price_id, plan_code, status, stripe_synced_at)
      values ('${ALICE}', 'sub_A', 'price_A', 'plus', 'lapsed', now())`],
    [`insert into public.subscriptions (learner_id, stripe_subscription_id, stripe_price_id, plan_code, status, stripe_synced_at)
      values ('${ALICE}', 'si_A', 'price_A', 'plus', 'active', now())`],
    [`insert into public.plan_passes (learner_id, plan_code, starts_at, ends_at, stripe_checkout_session_id, amount_minor, currency)
      values ('${ALICE}', 'plus', now(), now(), 'cs_test_A', 100, 'eur')`],
    [`insert into public.plan_passes (learner_id, plan_code, starts_at, ends_at, stripe_checkout_session_id, amount_minor, currency)
      values ('${ALICE}', 'plus', now(), now() + interval '731 days', 'cs_test_A', 100, 'eur')`],
    [`insert into public.plan_passes (learner_id, plan_code, starts_at, ends_at, stripe_checkout_session_id, amount_minor, currency)
      values ('${ALICE}', 'plus', now(), now() + interval '1 day', 'cs_test_A', -1, 'eur')`],
    [`insert into public.plan_passes (learner_id, plan_code, starts_at, ends_at, stripe_checkout_session_id, amount_minor, currency)
      values ('${ALICE}', 'plus', now(), now() + interval '1 day', 'cs_test_A', 100, 'EUR')`],
    [`insert into public.billing_prices (stripe_price_id, currency, lookup_key, plan_code, kind, billing_interval, pass_days, unit_amount_minor, fetched_at)
      values ('price_A', 'eur', 'dp_plus_month', 'plus', 'subscription', null, null, 999, now())`],
    [`insert into public.billing_prices (stripe_price_id, currency, lookup_key, plan_code, kind, billing_interval, pass_days, unit_amount_minor, fetched_at)
      values ('price_A', 'eur', 'dp_pass_plus', 'plus', 'pass', 'month', 180, 4499, now())`],
    [`insert into public.billing_prices (stripe_price_id, currency, lookup_key, plan_code, kind, billing_interval, pass_days, unit_amount_minor, fetched_at)
      values ('price_A', 'eur', 'dp_gold_month', 'plus', 'subscription', 'month', null, 999, now())`],
    [`insert into public.billing_events (stripe_event_id, event_type, stripe_created_at, status, error_code)
      values ('evt_A', 'invoice.paid', now(), 'failed', 'No such customer: cus_123')`],
  ])("%s", async (sql) => {
    expect(await refusal(() => database.db.query(sql))).toBe("23514");
  });

  it("refuses an order that does not record the early-start consent", async () => {
    // The consent is the reason the row exists (spec S6, S11): no row, no Checkout.
    expect(
      await refusal(() =>
        database.db.query(
          `insert into public.billing_checkouts (learner_id, offer_key, kind, terms_version)
           values ($1, 'dp_plus_month', 'order', '2026-09-25')`,
          [ALICE],
        ),
      ),
    ).toBe("23514");
  });

  it("takes a trial without consent, and only for Premium's subscriptions", async () => {
    // A trial that cannot become a charge places no paid order.
    await expect(
      database.db.query(
        `insert into public.billing_checkouts (learner_id, offer_key, kind, terms_version)
         values ($1, 'dp_premium_month', 'trial', '2026-09-25')`,
        [ALICE],
      ),
    ).resolves.toBeDefined();

    for (const offer of ["dp_plus_month", "dp_pass_premium"]) {
      expect(
        await refusal(() =>
          database.db.query(
            `insert into public.billing_checkouts (learner_id, offer_key, kind, terms_version)
             values ($1, $2, 'trial', '2026-09-25')`,
            [ALICE, offer],
          ),
        ),
        offer,
      ).toBe("23514");
    }
  });

  it("maps one Stripe customer to one learner, and one learner to one customer", async () => {
    await database.db.query(`insert into public.billing_customers values ($1, 'cus_One', now())`, [ALICE]);

    expect(
      await refusal(() => database.db.query(`insert into public.billing_customers values ($1, 'cus_One', now())`, [BOB])),
    ).toBe("23505");
    expect(
      await refusal(() => database.db.query(`insert into public.billing_customers values ($1, 'cus_Two', now())`, [ALICE])),
    ).toBe("23505");
  });

  it("goes with the account: deleting the profile deletes every billing row", async () => {
    const carol = "33333333-3333-4333-8333-333333333333";
    await database.seedLearner(carol);
    await admin().saveCustomer(carol, "cus_Carol");
    await admin().upsertSubscription(subscription({ learnerId: carol, stripeSubscriptionId: "sub_Carol" }));
    await admin().grantPass(pass({ learnerId: carol, stripeCheckoutSessionId: "cs_test_Carol", stripePaymentIntentId: null }));

    await database.db.query(`delete from public.profiles where id = $1`, [carol]);

    for (const table of ["billing_customers", "subscriptions", "plan_passes", "billing_checkouts"]) {
      const left = await database.db.query(`select 1 from public.${table} where learner_id = $1`, [carol]);
      expect(left.rows, table).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------

describe("claiming a webhook event", () => {
  const claim = () =>
    call<string>(`public.billing_claim_event('evt_One', 'invoice.paid', $1::timestamptz)`, [NOW.toISOString()]);

  it("is new once, then a retry while unfinished, then processed for good", async () => {
    expect(await claim()).toBe("new");
    // Stripe redelivered before the first attempt finished, or after it crashed.
    expect(await claim()).toBe("retry");

    await admin().finishEvent("evt_One", "processed");
    expect(await claim()).toBe("processed");

    const row = await database.db.query<{ attempts: number; status: string }>(
      `select attempts, status from public.billing_events where stripe_event_id = 'evt_One'`,
    );
    // A duplicate of a finished event is not an attempt: nothing was done.
    expect(row.rows[0]).toEqual({ attempts: 2, status: "processed" });
  });

  it("retries a failed event, and treats an ignored one as finished", async () => {
    expect(await claim()).toBe("new");
    await admin().finishEvent("evt_One", "failed", "stripe_unavailable");
    expect(await claim()).toBe("retry");

    const retried = await database.db.query<{ status: string; attempts: number }>(
      `select status, attempts from public.billing_events where stripe_event_id = 'evt_One'`,
    );
    expect(retried.rows[0]).toEqual({ status: "received", attempts: 2 });

    await admin().finishEvent("evt_One", "ignored", "unknown_customer");
    expect(await claim()).toBe("processed");
  });
});

describe("recording a subscription", () => {
  it("creates the row, then reports what it was and what it is", async () => {
    const created = await admin().upsertSubscription(subscription());
    expect(created.ok && created.data.before).toBeNull();
    expect(created.ok && created.data.applied).toBe(true);

    const changed = await admin().upsertSubscription(
      subscription({ status: "past_due", syncedAt: LATER }),
    );

    expect(changed.ok, JSON.stringify(!changed.ok && changed.error)).toBe(true);
    if (!changed.ok) return;
    expect(changed.data.before?.status).toBe("active");
    expect(changed.data.after).toMatchObject({
      learnerId: ALICE,
      stripeSubscriptionId: "sub_Alice1",
      planCode: "plus",
      status: "past_due",
      cancelAtPeriodEnd: false,
    });
    expect(changed.data.after.currentPeriodEnd).toEqual(new Date("2026-10-25T12:00:00Z"));
    expect(changed.data.after.id).toBe(changed.data.before?.id);
  });

  it("never lets an older read overwrite a newer one", async () => {
    // Two handlers retrieved the subscription at different moments; the slower
    // one's write arrives last. What Stripe said later stands.
    await admin().upsertSubscription(subscription({ status: "canceled", syncedAt: LATER }));

    const stale = await admin().upsertSubscription(subscription({ status: "active", syncedAt: NOW }));

    expect(stale.ok && stale.data.applied).toBe(false);
    expect(stale.ok && stale.data.after.status).toBe("canceled");
  });

  it("refuses to move a subscription to another learner", async () => {
    await admin().upsertSubscription(subscription());

    const moved = await admin().upsertSubscription(subscription({ learnerId: BOB, syncedAt: LATER }));

    expect(moved).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });
});

describe("granting a pass", () => {
  it("is idempotent on the Checkout Session: a redelivery grants nothing twice", async () => {
    const first = await admin().grantPass(pass());
    const again = await admin().grantPass(pass({ at: LATER, days: 90 }));

    expect(first.ok && first.data.created).toBe(true);
    expect(again.ok && again.data.created).toBe(false);
    // The pass as first granted, not as the redelivery computed it.
    expect(again.ok && again.data.pass).toEqual(first.ok && first.data.pass);

    const rows = await database.db.query(`select 1 from public.plan_passes`);
    expect(rows.rows).toHaveLength(1);
  });

  it("is revoked once by a refund of its payment, and not again", async () => {
    await admin().grantPass(pass());

    const revoked = await admin().revokePassByPaymentIntent("pi_Pass1", LATER);
    const twice = await admin().revokePassByPaymentIntent("pi_Pass1", new Date("2026-12-01T00:00:00Z"));

    expect(revoked.ok && revoked.data).toMatchObject({ learnerId: ALICE, planCode: "plus" });
    expect(twice).toEqual({ ok: true, data: null });

    const passes = await admin().passesFor(ALICE);
    // The first refund's time stands.
    expect(passes.ok && passes.data[0]?.revokedAt).toEqual(LATER);
  });

  it("reports nothing for a payment it never granted a pass for", async () => {
    expect(await admin().revokePassByPaymentIntent("pi_Unknown", LATER)).toEqual({ ok: true, data: null });
  });

  it("starts a pass now, for its days", async () => {
    const granted = await admin().grantPass(pass());

    expect(granted.ok && granted.data.pass).toMatchObject({
      startsAt: NOW,
      endsAt: new Date("2027-03-24T12:00:00Z"),
    });
  });

  it("stacks a pass after the last of the same plan, deciding the start itself", async () => {
    // Two purchases handled at the same moment both asked to start NOW. The
    // start is the database's to decide, under the learner's lock, so the
    // second begins where the first ends instead of running beside it.
    await admin().grantPass(pass());
    const second = await admin().grantPass(pass({ stripeCheckoutSessionId: "cs_test_Pass2", stripePaymentIntentId: "pi_Pass2" }));

    expect(second.ok && second.data.pass).toMatchObject({
      startsAt: new Date("2027-03-24T12:00:00Z"),
      endsAt: new Date("2027-09-20T12:00:00Z"),
    });
  });

  it("starts a pass of another plan now, beside the running one", async () => {
    await admin().grantPass(pass());
    const premium = await admin().grantPass(
      pass({ planCode: "premium", days: 90, stripeCheckoutSessionId: "cs_test_Premium", stripePaymentIntentId: "pi_Premium" }),
    );

    expect(premium.ok && premium.data.pass.startsAt).toEqual(NOW);
  });

  it("brings the passes stacked behind a refunded one forward, so no paid day is lost", async () => {
    // A: now → +180d. B, bought the next day, stacked at +180d → +360d.
    // A refunded on day 10: B now runs from day 10.
    await admin().grantPass(pass());
    await admin().grantPass(
      pass({ stripeCheckoutSessionId: "cs_test_Pass2", stripePaymentIntentId: "pi_Pass2", at: new Date(NOW.getTime() + DAY) }),
    );
    const refundedAt = new Date(NOW.getTime() + 10 * DAY);

    await admin().revokePassByPaymentIntent("pi_Pass1", refundedAt);

    const passes = await admin().passesFor(ALICE);
    const second = passes.ok ? passes.data.find((row) => row.stripeCheckoutSessionId === "cs_test_Pass2") : undefined;
    expect(second).toMatchObject({
      startsAt: refundedAt,
      endsAt: new Date(refundedAt.getTime() + 180 * DAY),
      revokedAt: null,
    });
  });

  it("brings later passes forward by the whole of a refunded pass that had not begun", async () => {
    await admin().grantPass(pass());
    await admin().grantPass(pass({ stripeCheckoutSessionId: "cs_test_Pass2", stripePaymentIntentId: "pi_Pass2" }));
    await admin().grantPass(pass({ stripeCheckoutSessionId: "cs_test_Pass3", stripePaymentIntentId: "pi_Pass3" }));

    await admin().revokePassByPaymentIntent("pi_Pass2", LATER);

    const passes = await admin().passesFor(ALICE);
    const third = passes.ok ? passes.data.find((row) => row.stripeCheckoutSessionId === "cs_test_Pass3") : undefined;
    const first = passes.ok ? passes.data.find((row) => row.stripeCheckoutSessionId === "cs_test_Pass1") : undefined;
    expect(third).toMatchObject({
      startsAt: new Date("2027-03-24T12:00:00Z"),
      endsAt: new Date("2027-09-20T12:00:00Z"),
    });
    // Nothing before the refunded pass moves.
    expect(first).toMatchObject({ startsAt: NOW, endsAt: new Date("2027-03-24T12:00:00Z") });
  });

  it("moves no pass of another plan, and no other learner's, when one is refunded", async () => {
    await admin().grantPass(pass());
    await admin().grantPass(
      pass({ planCode: "premium", days: 90, stripeCheckoutSessionId: "cs_test_Premium", stripePaymentIntentId: "pi_Premium" }),
    );
    await admin().grantPass(pass({ learnerId: BOB, stripeCheckoutSessionId: "cs_test_Bob", stripePaymentIntentId: "pi_Bob" }));
    await admin().grantPass(pass({ learnerId: BOB, stripeCheckoutSessionId: "cs_test_Bob2", stripePaymentIntentId: "pi_Bob2" }));

    await admin().revokePassByPaymentIntent("pi_Pass1", LATER);

    const alice = await admin().passesFor(ALICE);
    const bob = await admin().passesFor(BOB);
    expect(alice.ok && alice.data.find((row) => row.planCode === "premium")?.startsAt).toEqual(NOW);
    expect(bob.ok && bob.data.find((row) => row.stripeCheckoutSessionId === "cs_test_Bob2")?.startsAt).toEqual(
      new Date("2027-03-24T12:00:00Z"),
    );
  });

  it("lists a learner's passes, latest ending first, and nobody else's", async () => {
    await admin().grantPass(pass());
    // Stacked by the database after the first.
    await admin().grantPass(pass({ stripeCheckoutSessionId: "cs_test_Pass2", stripePaymentIntentId: "pi_Pass2" }));
    await admin().grantPass(pass({ learnerId: BOB, stripeCheckoutSessionId: "cs_test_Bob", stripePaymentIntentId: null }));

    const passes = await admin().passesFor(ALICE);

    expect(passes.ok && passes.data.map((row) => row.stripeCheckoutSessionId)).toEqual(["cs_test_Pass2", "cs_test_Pass1"]);
    expect(passes.ok && passes.data[0]).toMatchObject({ planCode: "plus", amountMinor: 4499, currency: "eur", revokedAt: null });
  });
});

describe("the price mirror", () => {
  const catalogue = () => [
    price(),
    price({ currency: "usd", unitAmountMinor: 1099 }),
    price({
      stripePriceId: "price_PassPlus",
      lookupKey: "dp_pass_plus",
      kind: "pass",
      interval: null,
      passDays: 180,
      unitAmountMinor: 4499,
    }),
  ];

  it("mirrors one row per price and currency, stamped with when it was fetched", async () => {
    const replaced = await admin().replacePrices(catalogue(), NOW);
    expect(replaced).toEqual({ ok: true, data: { upserted: 3, deactivated: 0 } });

    const prices = await admin().activePrices();
    expect(prices.ok && prices.data.map((row) => [row.lookupKey, row.currency, row.unitAmountMinor])).toEqual([
      ["dp_pass_plus", "eur", 4499],
      ["dp_plus_month", "eur", 999],
      ["dp_plus_month", "usd", 1099],
    ]);
    expect(prices.ok && prices.data[0]).toMatchObject({ passDays: 180, interval: null, fetchedAt: NOW, active: true });
  });

  it("keeps a price Stripe stopped listing, marked inactive, and says how many", async () => {
    await admin().replacePrices(catalogue(), NOW);

    const replaced = await admin().replacePrices([price({ unitAmountMinor: 1199 })], LATER);

    expect(replaced).toEqual({ ok: true, data: { upserted: 1, deactivated: 2 } });
    const prices = await admin().activePrices();
    expect(prices.ok && prices.data.map((row) => [row.currency, row.unitAmountMinor, row.fetchedAt])).toEqual([
      ["eur", 1199, LATER],
    ]);
    const all = await database.db.query(`select 1 from public.billing_prices`);
    expect(all.rows).toHaveLength(3);
  });

  it("follows a lookup key Stripe moved to a new price", async () => {
    // A price change in Stripe is a new Price that takes over the lookup key.
    await admin().replacePrices([price()], NOW);

    const moved = await admin().replacePrices([price({ stripePriceId: "price_PlusMonth2", unitAmountMinor: 1099 })], LATER);

    expect(moved.ok).toBe(true);
    const prices = await admin().activePrices();
    expect(prices.ok && prices.data.map((row) => row.stripePriceId)).toEqual(["price_PlusMonth2"]);
  });

  it("refuses two active prices for one offer in one currency", async () => {
    expect(
      await refusal(() =>
        database.db.query(
          `insert into public.billing_prices
             (stripe_price_id, currency, lookup_key, plan_code, kind, billing_interval, unit_amount_minor, fetched_at)
           values ('price_A', 'eur', 'dp_plus_month', 'plus', 'subscription', 'month', 999, now()),
                  ('price_B', 'eur', 'dp_plus_month', 'plus', 'subscription', 'month', 999, now())`,
        ),
      ),
    ).toBe("23505");
  });
});

// ---------------------------------------------------------------------------

describe("the admin repository", () => {
  it("creates a customer mapping once and returns the stored one ever after", async () => {
    const first = await admin().saveCustomer(ALICE, "cus_First");
    // A second checkout that raced the first created a second Stripe customer.
    // The mapping that was stored first stays; the caller uses it.
    const second = await admin().saveCustomer(ALICE, "cus_Second");

    expect(first).toEqual({ ok: true, data: "cus_First" });
    expect(second).toEqual({ ok: true, data: "cus_First" });
    expect(await admin().customerFor(ALICE)).toEqual({ ok: true, data: "cus_First" });
    expect(await admin().customerFor(BOB)).toEqual({ ok: true, data: null });
  });

  it("finds the learner behind a customer, and nobody behind an unknown one", async () => {
    await admin().saveCustomer(ALICE, "cus_First");

    expect(await admin().learnerForCustomer("cus_First")).toEqual({ ok: true, data: ALICE });
    expect(await admin().learnerForCustomer("cus_Nobody")).toEqual({ ok: true, data: null });
  });

  it("refuses a customer already mapped to another learner", async () => {
    await admin().saveCustomer(ALICE, "cus_First");

    expect(await admin().saveCustomer(BOB, "cus_First")).toMatchObject({ ok: false, error: { kind: "conflict" } });
  });

  it("records an order, attaches its Checkout Session, and follows its status", async () => {
    const created = await admin().createCheckout({
      learnerId: ALICE,
      offerKey: "dp_premium_year",
      kind: "order",
      termsVersion: "2026-09-25",
      earlyStartConsentAt: NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await admin().attachCheckoutSession(created.data, "cs_test_Order1")).toEqual({ ok: true, data: true });
    expect(await admin().setCheckoutStatus("cs_test_Order1", "completed")).toEqual({ ok: true, data: true });
    expect(await admin().setCheckoutStatus("cs_test_Unknown", "expired")).toEqual({ ok: true, data: false });

    const row = await database.db.query<Record<string, unknown>>(`select * from public.billing_checkouts where id = $1`, [
      created.data,
    ]);
    const parsed = billingCheckoutRowSchema.parse(row.rows[0]);
    expect(parsed).toMatchObject({
      learner_id: ALICE,
      offer_key: "dp_premium_year",
      status: "completed",
      stripe_checkout_session_id: "cs_test_Order1",
    });
  });

  it("refuses an order without consent before it reaches the database", async () => {
    const refused = await admin().createCheckout({
      learnerId: ALICE,
      offerKey: "dp_plus_month",
      kind: "order",
      termsVersion: "2026-09-25",
      earlyStartConsentAt: null,
    });

    expect(refused).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    const rows = await database.db.query(`select 1 from public.billing_checkouts`);
    expect(rows.rows).toEqual([]);
  });

  it("marks an order whose Checkout Session never opened as failed", async () => {
    const created = await admin().createCheckout({
      learnerId: ALICE,
      offerKey: "dp_plus_month",
      kind: "order",
      termsVersion: "2026-09-25",
      earlyStartConsentAt: NOW,
    });
    if (!created.ok) throw new Error("no checkout");

    expect(await admin().abandonCheckout(created.data)).toEqual({ ok: true, data: true });
    // Only a checkout that never opened: one Stripe is holding is the webhook's to settle.
    expect(await admin().abandonCheckout(created.data)).toEqual({ ok: true, data: false });

    const row = await database.db.query<{ status: string }>(`select status from public.billing_checkouts where id = $1`, [
      created.data,
    ]);
    expect(row.rows[0]?.status).toBe("failed");
  });

  it("refuses to record a trial through the order path", async () => {
    // The one trial is opened through openTrialCheckout, which holds it to one.
    const refused = await admin().createCheckout({
      learnerId: ALICE,
      offerKey: "dp_premium_month",
      kind: "trial" as never,
      termsVersion: "2026-09-25",
      earlyStartConsentAt: null,
    });

    expect(refused).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  });

  it("finds the offer a price was sold as, even after Stripe moved its lookup key on", async () => {
    await admin().replacePrices([price()], NOW);
    await admin().replacePrices([price({ stripePriceId: "price_PlusMonth2", unitAmountMinor: 1099 })], LATER);

    expect(await admin().priceOffer("price_PlusMonth")).toEqual({
      ok: true,
      data: { lookupKey: "dp_plus_month", passDays: null },
    });
    expect(await admin().priceOffer("price_Unknown")).toEqual({ ok: true, data: null });
  });

  it("reads back the plan and price a subscription was stored with", async () => {
    await admin().upsertSubscription(subscription());

    expect(await admin().storedSubscription("sub_Alice1")).toEqual({
      ok: true,
      data: { planCode: "plus", stripePriceId: "price_PlusMonth" },
    });
    expect(await admin().storedSubscription("sub_Nobody")).toEqual({ ok: true, data: null });
  });

  it("finishes an event with a code, never a sentence", async () => {
    await admin().claimEvent({ eventId: "evt_Two", type: "charge.refunded", createdAt: NOW });

    expect(await admin().finishEvent("evt_Two", "failed", "No such payment_intent")).toMatchObject({
      ok: false,
      error: { kind: "invalid_input" },
    });
    expect(await admin().finishEvent("evt_Two", "failed", "stripe_rate_limited", LATER)).toEqual({ ok: true, data: true });

    const row = await database.db.query<{ status: string; error_code: string; processed_at: unknown }>(
      `select status, error_code, processed_at from public.billing_events where stripe_event_id = 'evt_Two'`,
    );
    expect(row.rows[0]).toMatchObject({ status: "failed", error_code: "stripe_rate_limited", processed_at: null });
  });

  it("claims through the repository in the database's own terms", async () => {
    const event = { eventId: "evt_Three", type: "customer.subscription.updated", createdAt: NOW };

    expect(await admin().claimEvent(event)).toEqual({ ok: true, data: "new" });
    expect(await admin().claimEvent(event)).toEqual({ ok: true, data: "retry" });
    await admin().finishEvent("evt_Three", "processed", null, LATER);
    expect(await admin().claimEvent(event)).toEqual({ ok: true, data: "processed" });
  });
});

// ---------------------------------------------------------------------------

describe("opening the one trial", () => {
  const OPEN_SECONDS = 1800;
  const open = (learnerId: string = ALICE) =>
    admin().openTrialCheckout({
      learnerId,
      offerKey: "dp_premium_month",
      termsVersion: "2026-09-25",
      openForSeconds: OPEN_SECONDS,
    });
  /** Ages every checkout, as if it had been opened that long ago. */
  const age = (seconds: number) =>
    database.db.query(`update public.billing_checkouts set created_at = now() - make_interval(secs => $1)`, [seconds]);

  it("records a trial checkout for a learner who has never had one", async () => {
    const opened = await open();

    expect(opened.ok && opened.data.status).toBe("created");
    const rows = await database.db.query<{ kind: string; offer_key: string; early_start_consent_at: unknown }>(
      `select kind, offer_key, early_start_consent_at from public.billing_checkouts where learner_id = $1`,
      [ALICE],
    );
    expect(rows.rows).toEqual([{ kind: "trial", offer_key: "dp_premium_month", early_start_consent_at: null }]);
  });

  it("refuses a second while the first can still be completed on Stripe's page", async () => {
    await open();

    expect(await open()).toEqual({ ok: true, data: { status: "open" } });
    const rows = await database.db.query(`select 1 from public.billing_checkouts where learner_id = $1`, [ALICE]);
    expect(rows.rows).toHaveLength(1);
  });

  it("opens again once the first's session can no longer be completed", async () => {
    await open();
    // Stripe expires the session after OPEN_SECONDS; nothing can complete it now.
    await age(OPEN_SECONDS + 600);

    const reopened = await open();

    expect(reopened.ok && reopened.data.status).toBe("created");
  });

  it("does not let a failed attempt hold the trial", async () => {
    const first = await open();
    if (!first.ok || first.data.status !== "created") throw new Error("not opened");

    await admin().abandonCheckout(first.data.id);
    const retried = await open();

    expect(retried.ok && retried.data.status).toBe("created");
  });

  it("refuses for good once a trial was completed", async () => {
    const first = await open();
    if (!first.ok || first.data.status !== "created") throw new Error("not opened");
    await admin().attachCheckoutSession(first.data.id, "cs_test_Trial1");
    await admin().setCheckoutStatus("cs_test_Trial1", "completed");
    await age(400 * 86_400);

    expect(await open()).toEqual({ ok: true, data: { status: "used" } });
  });

  it("refuses a learner who has any subscription at all", async () => {
    await admin().upsertSubscription(subscription({ status: "canceled" }));

    expect(await open()).toEqual({ ok: true, data: { status: "used" } });
    expect((await open(BOB)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("the learner's repository, under RLS", () => {
  beforeEach(async () => {
    await admin().saveCustomer(ALICE, "cus_Alice");
    await admin().upsertSubscription(subscription({ status: "canceled", canceledAt: NOW }));
    await admin().upsertSubscription(
      subscription({ stripeSubscriptionId: "sub_Alice2", planCode: "premium", status: "trialing", trialEnd: LATER }),
    );
    await admin().grantPass(pass());
    await admin().saveCustomer(BOB, "cus_Bob");
    await admin().upsertSubscription(subscription({ learnerId: BOB, stripeSubscriptionId: "sub_Bob" }));
    await admin().grantPass(pass({ learnerId: BOB, stripeCheckoutSessionId: "cs_test_Bob", stripePaymentIntentId: null }));
  });

  it("reads the learner's own grants, in the shape entitlement resolves", async () => {
    const grants = await database.asLearner(ALICE, () => learnerRepo().grantsFor(ALICE));

    expect(grants.ok, JSON.stringify(!grants.ok && grants.error)).toBe(true);
    if (!grants.ok) return;
    expect(grants.data.customerId).toBe("cus_Alice");
    expect(grants.data.hasEverSubscribed).toBe(true);
    expect(grants.data.subscriptions).toHaveLength(2);
    expect(grants.data.subscriptions).toContainEqual({
      planCode: "premium",
      status: "trialing",
      currentPeriodEnd: new Date("2026-10-25T12:00:00Z"),
      cancelAtPeriodEnd: false,
      trialEnd: LATER,
    });
    expect(grants.data.passes).toEqual([
      { planCode: "plus", startsAt: NOW, endsAt: new Date("2027-03-24T12:00:00Z"), revokedAt: null },
    ]);
  });

  it("sees nothing of another learner, even when asked for them by id", async () => {
    const asked = await database.asLearner(ALICE, () => learnerRepo().grantsFor(BOB));

    expect(asked).toEqual({
      ok: true,
      data: { customerId: null, subscriptions: [], passes: [], hasEverSubscribed: false },
    });
  });

  it("has never subscribed when there are no rows at all", async () => {
    const carol = "33333333-3333-4333-8333-333333333333";
    await database.seedLearner(carol);

    const grants = await database.asLearner(carol, () => learnerRepo().grantsFor(carol));

    expect(grants.ok && grants.data.hasEverSubscribed).toBe(false);
  });

  it("lists subscriptions for display, newest first", async () => {
    const listed = await database.asLearner(ALICE, () => learnerRepo().subscriptionsFor(ALICE));

    expect(listed.ok && listed.data.map((row) => [row.planCode, row.status])).toEqual([
      ["premium", "trialing"],
      ["plus", "canceled"],
    ]);
    expect(listed.ok && listed.data[1]?.canceledAt).toEqual(NOW);
  });

  it("refuses an id that is not one before any query", async () => {
    const refused = await database.asLearner(ALICE, () => learnerRepo().grantsFor("alice"));

    expect(refused).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  });
});

// ---------------------------------------------------------------------------

const CONTRACTS: ReadonlyArray<[string, ZodObject]> = [
  ["billing_customers", billingCustomerRowSchema],
  ["billing_checkouts", billingCheckoutRowSchema],
  ["subscriptions", subscriptionRowSchema],
  ["plan_passes", planPassRowSchema],
  ["billing_prices", billingPriceRowSchema],
];

describe.each(CONTRACTS)("%s row schema", (table, schema) => {
  it("reads only columns the migration creates", async () => {
    const actual = new Set(
      (
        await database.db.query<{ column_name: string }>(
          `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
          [table],
        )
      ).rows.map((row) => row.column_name),
    );

    expect(Object.keys(schema.shape).filter((column) => !actual.has(column))).toEqual([]);
  });
});
