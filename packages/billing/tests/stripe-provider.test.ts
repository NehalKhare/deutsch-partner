import { describe, expect, it, vi } from "vitest";

import { BillingProviderError, billingErrorFrom } from "../src/errors";
import { TRIAL_CHECKOUT_LIFETIME_SECONDS, type CheckoutSessionInput } from "../src/provider";
import { createStripeProvider, type StripeClient } from "../src/stripe-provider";
import {
  T0,
  stripeCharge,
  stripeCheckoutSession,
  stripeEvent,
  stripeInvoice,
  stripePassSession,
  stripePrice,
  stripeSubscription,
} from "./support/stripe-objects";

/**
 * The Stripe provider against a client shaped like the SDK.
 *
 * What is asserted is what goes to Stripe and what comes back out: the exact
 * Checkout parameters the spec requires (and the ones it forbids), and that
 * every object is reduced to the fields this application acts on, with no
 * Stripe type, message or personal detail getting through.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";
const CHECKOUT_ID = "33333333-3333-4333-8333-333333333333";

function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  const client = {
    customers: { create: vi.fn(async () => ({ id: "cus_Alice", object: "customer", email: null })) },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ id: "cs_test_Order1", url: "https://checkout.stripe.com/c/pay/cs_test_Order1" })),
        retrieve: vi.fn(async () => stripeCheckoutSession()),
      },
    },
    billingPortal: {
      sessions: { create: vi.fn(async () => ({ id: "bps_1", url: "https://billing.stripe.com/p/session/abc" })) },
    },
    subscriptions: {
      retrieve: vi.fn(async () => stripeSubscription()),
      update: vi.fn(async () => stripeSubscription({ cancel_at_period_end: true })),
    },
    charges: { retrieve: vi.fn(async () => stripeCharge()) },
    prices: { list: vi.fn(async () => ({ object: "list", data: [stripePrice()], has_more: false })) },
    webhooks: { constructEvent: vi.fn(() => stripeEvent("customer.subscription.updated", stripeSubscription())) },
    ...over,
  };
  return client;
}

function providerOver(client: ReturnType<typeof fakeClient>) {
  return createStripeProvider({
    secretKey: "sk_test_51AbcDEFghiJKLmno",
    webhookSecret: "whsec_AbcDEFghiJKLmno123",
    client: client as unknown as StripeClient,
  });
}

function order(over: Partial<CheckoutSessionInput> = {}): CheckoutSessionInput {
  return {
    customerId: "cus_Alice",
    priceId: "price_PlusMonth",
    mode: "subscription",
    trial: null,
    successUrl: "https://deutsch-partner.example/billing/success",
    cancelUrl: "https://deutsch-partner.example/pricing",
    automaticTax: false,
    clientReferenceId: CHECKOUT_ID,
    submitMessage: "You have ordered Plus, monthly, for EUR 9.99 incl. VAT.",
    ...over,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof BillingProviderError ? error.code : "not a billing error";
  }
}

describe("createCustomer", () => {
  it("creates a customer that carries the learner id and nothing personal", async () => {
    const client = fakeClient();

    const created = await providerOver(client).createCustomer({ learnerId: LEARNER });

    expect(created).toEqual({ customerId: "cus_Alice" });
    const [params, options] = client.customers.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toEqual({ metadata: { learner_id: LEARNER } });
    // A double submit must not make two customers, of which only one is mapped.
    expect(options).toEqual({ idempotencyKey: `customer-${LEARNER}` });
  });

  it("refuses a learner id that is not one before calling Stripe", async () => {
    const client = fakeClient();

    expect(await codeOf(providerOver(client).createCustomer({ learnerId: "alice" }))).toBe("billing_invalid_input");
    expect(client.customers.create).not.toHaveBeenCalled();
  });

  it("refuses a response that is not a customer", async () => {
    const client = fakeClient({ customers: { create: vi.fn(async () => ({ id: "acct_1" })) } });

    expect(await codeOf(providerOver(client).createCustomer({ learnerId: LEARNER }))).toBe("stripe_invalid_response");
  });
});

describe("createCheckoutSession", () => {
  const sent = (client: ReturnType<typeof fakeClient>) =>
    client.checkout.sessions.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];

  it("opens hosted Checkout for a subscription with exactly the parameters the spec names", async () => {
    const client = fakeClient();

    const session = await providerOver(client).createCheckoutSession(order());

    expect(session).toEqual({ id: "cs_test_Order1", url: "https://checkout.stripe.com/c/pay/cs_test_Order1" });
    const [params, options] = sent(client);
    expect(params).toEqual({
      mode: "subscription",
      customer: "cus_Alice",
      line_items: [{ price: "price_PlusMonth", quantity: 1 }],
      allow_promotion_codes: true,
      locale: "en",
      automatic_tax: { enabled: false },
      custom_text: { submit: { message: "You have ordered Plus, monthly, for EUR 9.99 incl. VAT." } },
      success_url: "https://deutsch-partner.example/billing/success",
      cancel_url: "https://deutsch-partner.example/pricing",
      client_reference_id: CHECKOUT_ID,
    });
    // One order is one session, however many times the button is pressed.
    expect(options).toEqual({ idempotencyKey: `checkout-${CHECKOUT_ID}` });
  });

  it("never lists payment method types: they are the Dashboard's (spec S6)", async () => {
    const client = fakeClient();

    await providerOver(client).createCheckoutSession(order());
    await providerOver(client).createCheckoutSession(order({ mode: "payment", priceId: "price_PassPlus" }));

    for (const [params] of client.checkout.sessions.create.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      expect(params).not.toHaveProperty("payment_method_types");
    }
  });

  it("starts the one trial with no card and no automatic charge", async () => {
    const client = fakeClient();

    await providerOver(client).createCheckoutSession(order({ priceId: "price_PremiumMonth", trial: { days: 7 } }));

    const [params] = sent(client);
    expect(params.payment_method_collection).toBe("if_required");
    expect(params.subscription_data).toEqual({
      trial_period_days: 7,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
  });

  it("lets a trial's session be completed for half an hour and a little more, not Stripe's day", async () => {
    const client = fakeClient();
    const before = Math.floor(Date.now() / 1000);

    await providerOver(client).createCheckoutSession(order({ priceId: "price_PremiumMonth", trial: { days: 7 } }));

    const [params] = sent(client);
    // Stripe accepts 30 minutes to 24 hours after it creates the session.
    expect(params.expires_at).toBeGreaterThanOrEqual(before + TRIAL_CHECKOUT_LIFETIME_SECONDS);
    expect(params.expires_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + TRIAL_CHECKOUT_LIFETIME_SECONDS);
    expect(TRIAL_CHECKOUT_LIFETIME_SECONDS).toBeGreaterThan(30 * 60);
    expect(TRIAL_CHECKOUT_LIFETIME_SECONDS).toBeLessThan(60 * 60);
  });

  it("leaves a paid order's session at Stripe's own lifetime", async () => {
    const client = fakeClient();

    await providerOver(client).createCheckoutSession(order());

    expect(sent(client)[0]).not.toHaveProperty("expires_at");
  });

  it("collects a payment method for every order that is not a trial", async () => {
    const client = fakeClient();

    await providerOver(client).createCheckoutSession(order());

    const [params] = sent(client);
    expect(params).not.toHaveProperty("payment_method_collection");
    expect(params).not.toHaveProperty("subscription_data");
  });

  it("buys a pass in payment mode, with an invoice for the purchase", async () => {
    const client = fakeClient();

    await providerOver(client).createCheckoutSession(order({ mode: "payment", priceId: "price_PassPlus" }));

    const [params] = sent(client);
    expect(params.mode).toBe("payment");
    expect(params.invoice_creation).toEqual({ enabled: true });
    expect(params).not.toHaveProperty("subscription_data");
  });

  it("computes VAT when told to, keeping the address Stripe Tax needs on the customer", async () => {
    const client = fakeClient();

    await providerOver(client).createCheckoutSession(order({ automaticTax: true }));

    const [params] = sent(client);
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.customer_update).toEqual({ address: "auto" });
  });

  it.each([
    ["a trial on a pass", order({ mode: "payment", trial: { days: 7 } })],
    ["a trial longer than the one on offer", order({ trial: { days: 30 } })],
    ["a price that is not a Stripe price", order({ priceId: "dp_plus_month" })],
    ["a customer that is not a Stripe customer", order({ customerId: "alice" })],
    ["an order reference that is not an order", order({ clientReferenceId: "order-1" })],
    ["a submit text over Stripe's limit", order({ submitMessage: "x".repeat(1201) })],
    ["no submit text", order({ submitMessage: "" })],
    ["a return address that is not a URL", order({ successUrl: "/billing/success" })],
  ])("refuses %s before calling Stripe", async (_label, input) => {
    const client = fakeClient();

    expect(await codeOf(providerOver(client).createCheckoutSession(input))).toBe("billing_invalid_input");
    expect(client.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("refuses a session with no hosted page to send the learner to", async () => {
    const client = fakeClient({
      checkout: { sessions: { create: vi.fn(async () => ({ id: "cs_test_Order1", url: null })), retrieve: vi.fn() } },
    });

    expect(await codeOf(providerOver(client).createCheckoutSession(order()))).toBe("stripe_invalid_response");
  });
});

describe("createPortalSession", () => {
  it("opens the Customer Portal for the learner's customer", async () => {
    const client = fakeClient();

    const portal = await providerOver(client).createPortalSession({
      customerId: "cus_Alice",
      returnUrl: "https://deutsch-partner.example/billing",
    });

    expect(portal).toEqual({ url: "https://billing.stripe.com/p/session/abc" });
    expect(client.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_Alice",
      return_url: "https://deutsch-partner.example/billing",
    });
  });
});

describe("retrieveSubscription", () => {
  it("reads the period end from the item, where this API version keeps it", async () => {
    const provider = providerOver(fakeClient());

    const subscription = await provider.retrieveSubscription("sub_Alice1");

    expect(subscription).toEqual({
      id: "sub_Alice1",
      customerId: "cus_Alice",
      status: "active",
      price: { priceId: "price_PlusMonth", lookupKey: "dp_plus_month", planCode: "plus", passDays: null },
      currentPeriodEnd: new Date((T0 + 30 * 86_400) * 1000),
      cancelAtPeriodEnd: false,
      trialEnd: null,
      canceledAt: null,
    });
  });

  it("takes the customer's id whether or not the customer was expanded", async () => {
    const client = fakeClient({
      subscriptions: {
        retrieve: vi.fn(async () => stripeSubscription({ customer: { id: "cus_Alice", object: "customer", email: "a@b.c" } })),
      },
    });

    const subscription = await providerOver(client).retrieveSubscription("sub_Alice1");

    expect(subscription.customerId).toBe("cus_Alice");
    expect(JSON.stringify(subscription)).not.toContain("a@b.c");
  });

  it("carries the trial and the cancellation through as dates", async () => {
    const client = fakeClient({
      subscriptions: {
        retrieve: vi.fn(async () =>
          stripeSubscription({ status: "trialing", trial_end: T0 + 7 * 86_400, cancel_at_period_end: true, canceled_at: T0 }),
        ),
      },
    });

    const subscription = await providerOver(client).retrieveSubscription("sub_Alice1");

    expect(subscription.status).toBe("trialing");
    expect(subscription.trialEnd).toEqual(new Date((T0 + 7 * 86_400) * 1000));
    expect(subscription.cancelAtPeriodEnd).toBe(true);
    expect(subscription.canceledAt).toEqual(new Date(T0 * 1000));
  });

  it("passes an unknown status through for the webhook to judge, rather than guessing", async () => {
    const client = fakeClient({
      subscriptions: { retrieve: vi.fn(async () => stripeSubscription({ status: "suspended" })) },
    });

    expect((await providerOver(client).retrieveSubscription("sub_Alice1")).status).toBe("suspended");
  });

  it("refuses a subscription with no item, which has no price to grant from", async () => {
    const client = fakeClient({
      subscriptions: {
        retrieve: vi.fn(async () => stripeSubscription({ items: { object: "list", data: [], has_more: false } })),
      },
    });

    expect(await codeOf(providerOver(client).retrieveSubscription("sub_Alice1"))).toBe("stripe_invalid_response");
  });

  it("refuses an id that is not a subscription's before calling Stripe", async () => {
    const client = fakeClient();

    expect(await codeOf(providerOver(client).retrieveSubscription("cus_Alice"))).toBe("billing_invalid_input");
    expect(client.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});

describe("cancelAtPeriodEnd", () => {
  it("sets the subscription to end at its period end and reads back what Stripe then says", async () => {
    const client = fakeClient();

    const updated = await providerOver(client).cancelAtPeriodEnd("sub_Alice1");

    expect(client.subscriptions.update).toHaveBeenCalledWith("sub_Alice1", { cancel_at_period_end: true });
    expect(updated).toMatchObject({ id: "sub_Alice1", cancelAtPeriodEnd: true });
  });

  it("refuses an id that is not a subscription's before calling Stripe", async () => {
    const client = fakeClient();

    expect(await codeOf(providerOver(client).cancelAtPeriodEnd("cus_Alice"))).toBe("billing_invalid_input");
    expect(client.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe("retrieveCheckoutSession", () => {
  it("expands the line items and reduces the session to what the webhook acts on", async () => {
    const client = fakeClient();

    const session = await providerOver(client).retrieveCheckoutSession("cs_test_Order1");

    expect(client.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_Order1", { expand: ["line_items"] });
    expect(session).toEqual({
      id: "cs_test_Order1",
      mode: "subscription",
      status: "complete",
      paymentStatus: "paid",
      customerId: "cus_Alice",
      subscriptionId: "sub_Alice1",
      paymentIntentId: null,
      clientReferenceId: CHECKOUT_ID,
      amountTotalMinor: 999,
      currency: "eur",
      price: { priceId: "price_PlusMonth", lookupKey: "dp_plus_month", planCode: "plus", passDays: null },
    });
  });

  it("reads a pass's length from its price's metadata", async () => {
    const client = fakeClient({
      checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(async () => stripePassSession()) } },
    });

    const session = await providerOver(client).retrieveCheckoutSession("cs_test_Pass1");

    expect(session.mode).toBe("payment");
    expect(session.paymentIntentId).toBe("pi_Pass1");
    expect(session.price).toEqual({ priceId: "price_PassPlus", lookupKey: "dp_pass_plus", planCode: "plus", passDays: "180" });
  });

  it("lets no customer detail through: no email, no name", async () => {
    const session = await providerOver(fakeClient()).retrieveCheckoutSession("cs_test_Order1");

    const serialised = JSON.stringify(session);
    expect(serialised).not.toContain("alice@example.com");
    expect(serialised).not.toContain("Alice Example");
  });

  it("reports no price when the session has no line item", async () => {
    const client = fakeClient({
      checkout: {
        sessions: {
          create: vi.fn(),
          retrieve: vi.fn(async () => stripeCheckoutSession({ line_items: { object: "list", data: [], has_more: false } })),
        },
      },
    });

    expect((await providerOver(client).retrieveCheckoutSession("cs_test_Order1")).price).toBeNull();
  });
});

describe("retrieveCharge", () => {
  it("reduces a charge to its payment and whether it was refunded in full", async () => {
    const charge = await providerOver(fakeClient()).retrieveCharge("ch_Pass1");

    expect(charge).toEqual({ id: "ch_Pass1", paymentIntentId: "pi_Pass1", refunded: true });
    expect(JSON.stringify(charge)).not.toContain("4242");
  });
});

describe("listPrices", () => {
  it("asks for the active prices under the given lookup keys, with every currency", async () => {
    const client = fakeClient();

    await providerOver(client).listPrices(["dp_plus_month", "dp_plus_year"]);

    expect(client.prices.list).toHaveBeenCalledWith({
      lookup_keys: ["dp_plus_month", "dp_plus_year"],
      active: true,
      limit: 100,
      expand: ["data.currency_options"],
    });
  });

  it("returns one entry per price and currency", async () => {
    const client = fakeClient({
      prices: {
        list: vi.fn(async () => ({
          object: "list",
          data: [
            stripePrice({
              currency_options: {
                // Stripe lists the price's own currency among its options.
                eur: { unit_amount: 999, tax_behavior: "inclusive", custom_unit_amount: null },
                usd: { unit_amount: 1099, tax_behavior: "inclusive", custom_unit_amount: null },
                gbp: { unit_amount: 899, tax_behavior: null, custom_unit_amount: null },
              },
            }),
          ],
          has_more: false,
        })),
      },
    });

    const prices = await providerOver(client).listPrices(["dp_plus_month"]);

    const common = {
      priceId: "price_PlusMonth",
      lookupKey: "dp_plus_month",
      planCode: "plus",
      passDays: null,
      recurring: { interval: "month", intervalCount: 1 },
    };
    expect(prices).toEqual([
      { ...common, currency: "eur", unitAmountMinor: 999, taxBehavior: "inclusive" },
      { ...common, currency: "usd", unitAmountMinor: 1099, taxBehavior: "inclusive" },
      // An option without its own tax behaviour inherits the price's.
      { ...common, currency: "gbp", unitAmountMinor: 899, taxBehavior: "inclusive" },
    ]);
  });

  it("refuses to be asked for more lookup keys than Stripe filters on", async () => {
    const client = fakeClient();
    const keys = Array.from({ length: 11 }, (_, index) => `dp_key_${index}`);

    expect(await codeOf(providerOver(client).listPrices(keys))).toBe("billing_invalid_input");
    expect(client.prices.list).not.toHaveBeenCalled();
  });

  it("refuses a page it cannot see the end of", async () => {
    const client = fakeClient({
      prices: { list: vi.fn(async () => ({ object: "list", data: [stripePrice()], has_more: true })) },
    });

    expect(await codeOf(providerOver(client).listPrices(["dp_plus_month"]))).toBe("stripe_invalid_response");
  });
});

describe("verifyWebhook, over the client", () => {
  it("returns nothing, and asks nothing, when there is no signature", async () => {
    const client = fakeClient();

    expect(await providerOver(client).verifyWebhook("{}", null)).toBeNull();
    expect(client.webhooks.constructEvent).not.toHaveBeenCalled();
  });

  it("returns nothing when the signature does not verify", async () => {
    const client = fakeClient({
      webhooks: {
        constructEvent: vi.fn(() => {
          throw Object.assign(new Error("No signatures found matching the expected signature for payload"), {
            type: "StripeSignatureVerificationError",
          });
        }),
      },
    });

    expect(await providerOver(client).verifyWebhook("{}", "t=1,v1=bad")).toBeNull();
  });

  it("checks against the configured secret, and reduces the event to a doorbell", async () => {
    const client = fakeClient();

    const event = await providerOver(client).verifyWebhook("{\"raw\":true}", "t=1,v1=abc");

    expect(client.webhooks.constructEvent).toHaveBeenCalledWith("{\"raw\":true}", "t=1,v1=abc", "whsec_AbcDEFghiJKLmno123");
    expect(event).toEqual({
      id: "evt_1",
      type: "customer.subscription.updated",
      created: new Date(T0 * 1000),
      objectId: "sub_Alice1",
      subscriptionId: "sub_Alice1",
    });
  });

  it("takes an invoice's subscription from its parent, where this API version keeps it", async () => {
    const client = fakeClient({
      webhooks: { constructEvent: vi.fn(() => stripeEvent("invoice.paid", stripeInvoice())) },
    });

    const event = await providerOver(client).verifyWebhook("{}", "t=1,v1=abc");

    expect(event?.objectId).toBe("in_Alice1");
    expect(event?.subscriptionId).toBe("sub_Alice1");
  });

  it("finds no subscription on an invoice that bills none", async () => {
    const client = fakeClient({
      webhooks: { constructEvent: vi.fn(() => stripeEvent("invoice.paid", stripeInvoice({ parent: null }))) },
    });

    expect((await providerOver(client).verifyWebhook("{}", "t=1,v1=abc"))?.subscriptionId).toBeNull();
  });

  it("verifies nothing when no webhook secret is configured", async () => {
    const client = fakeClient();
    const provider = createStripeProvider({
      secretKey: "sk_test_51AbcDEFghiJKLmno",
      webhookSecret: null,
      client: client as unknown as StripeClient,
    });

    expect(await provider.verifyWebhook("{}", "t=1,v1=abc")).toBeNull();
    expect(client.webhooks.constructEvent).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it.each([
    ["StripeRateLimitError", 429, undefined, "stripe_rate_limited"],
    ["StripeAuthenticationError", 401, undefined, "stripe_authentication"],
    ["StripePermissionError", 403, undefined, "stripe_permission"],
    ["StripeInvalidRequestError", 404, "resource_missing", "stripe_not_found"],
    ["StripeInvalidRequestError", 400, "parameter_invalid_empty", "stripe_invalid_request"],
    ["StripeIdempotencyError", 400, undefined, "stripe_idempotency"],
    ["StripeCardError", 402, "card_declined", "stripe_card_error"],
    ["StripeAPIError", 500, undefined, "stripe_unavailable"],
    ["StripeConnectionError", undefined, undefined, "stripe_unavailable"],
  ])("maps a %s (%s) to a closed code", async (type, statusCode, code, expected) => {
    const failure = Object.assign(new Error("No such customer: 'cus_x'; alice@example.com"), {
      type,
      statusCode,
      code,
      requestId: "req_123",
    });
    const client = fakeClient({ subscriptions: { retrieve: vi.fn(async () => Promise.reject(failure)) } });

    try {
      await providerOver(client).retrieveSubscription("sub_Alice1");
      expect.unreachable("expected a failure");
    } catch (error) {
      expect(error).toBeInstanceOf(BillingProviderError);
      const billing = error as BillingProviderError;
      expect(billing.code).toBe(expected);
      // Stripe's message can carry an email or an id; none of it is kept.
      expect(billing.message).toBe(expected);
      expect(JSON.stringify(billing)).not.toContain("alice@example.com");
      expect(String(billing)).not.toContain("alice@example.com");
      expect(billing.stripeRequestId).toBe("req_123");
    }
  });

  it("treats anything that is not a Stripe error as Stripe being unavailable", () => {
    expect(billingErrorFrom(new TypeError("fetch failed")).code).toBe("stripe_unavailable");
    expect(billingErrorFrom("boom").code).toBe("stripe_unavailable");
  });

  it("keeps a billing error as it is", () => {
    const original = new BillingProviderError("stripe_rate_limited");

    expect(billingErrorFrom(original)).toBe(original);
  });
});

describe("an order with no trial named", () => {
  it("is an order without one", async () => {
    const client = fakeClient();
    const { trial: _trial, ...withoutTrial } = order();

    await providerOver(client).createCheckoutSession(withoutTrial);

    const [params] = client.checkout.sessions.create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params).not.toHaveProperty("subscription_data");
    expect(params).not.toHaveProperty("payment_method_collection");
  });
});
