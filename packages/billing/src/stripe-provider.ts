import Stripe from "stripe";
import { z } from "zod";

import { stripeEventIdSchema, stripeSubscriptionIdSchema } from "@dp/db/billing-repository";

import { BillingProviderError, billingErrorFrom } from "./errors";
import {
  chargeIdInput,
  checkoutSessionIdInput,
  checkoutSessionInputSchema,
  customerInputSchema,
  lookupKeysInput,
  portalSessionInputSchema,
  subscriptionIdInput,
  TRIAL_CHECKOUT_LIFETIME_SECONDS,
  type BillingProvider,
  type NormalizedPrice,
  type NormalizedSubscription,
  type PriceReference,
  type VerifiedEvent,
} from "./provider";

/**
 * The BillingProvider over Stripe's Node SDK.
 *
 * The one module that holds a Stripe client (a CI test keeps the SDK out of
 * every other). It sends what billing-and-plans-spec.md S6 asks of hosted
 * Checkout, and reads back only what the webhook acts on.
 *
 * Every response is parsed, not trusted: the SDK's types describe the API
 * version this was written against, and a schema here checks what actually
 * arrived. Each schema names only the fields read, and tests/stripe-shapes
 * holds them against the SDK's own types, so an upgrade that moves a field
 * fails typecheck instead of a webhook.
 */

/**
 * The API version every field below was checked against, in
 * node_modules/stripe/esm/resources/*.d.ts. Typed as the SDK's literal, so an
 * SDK that speaks a different version does not compile until this changes —
 * and changing it is re-reading those files.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

/**
 * The slice of the SDK this module calls. Parameters are the SDK's own types,
 * so what is sent is checked against Stripe's definitions; results are
 * unknown, because they are parsed. The real client satisfies it, and a test
 * can hand in a few functions.
 */
export interface StripeClient {
  readonly customers: {
    create(params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions): Promise<unknown>;
  };
  readonly checkout: {
    readonly sessions: {
      create(params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<unknown>;
      retrieve(id: string, params?: Stripe.Checkout.SessionRetrieveParams): Promise<unknown>;
    };
  };
  readonly billingPortal: {
    readonly sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<unknown> };
  };
  readonly subscriptions: {
    retrieve(id: string, params?: Stripe.SubscriptionRetrieveParams): Promise<unknown>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<unknown>;
  };
  readonly charges: { retrieve(id: string, params?: Stripe.ChargeRetrieveParams): Promise<unknown> };
  readonly prices: { list(params: Stripe.PriceListParams): Promise<unknown> };
  readonly webhooks: { constructEvent(payload: string, header: string, secret: string): unknown };
}

/** The SDK client for a key. Construction makes no request. */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    // The SDK retries what is safe to retry, with idempotency keys it adds.
    maxNetworkRetries: 2,
    // A learner is waiting on the order page for the session.
    timeout: 20_000,
    telemetry: false,
    appInfo: { name: "deutsch-partner" },
  });
}

// --- the wire: exactly the fields read, as Stripe sends them ----------------------

/** Stripe's timestamps are Unix seconds. */
const seconds = z.number().int();
const dateOf = (value: number | null) => (value === null ? null : new Date(value * 1000));

/** A reference Stripe may or may not have expanded into the object. */
const expandable = z
  .union([z.string(), z.object({ id: z.string() })])
  .transform((value) => (typeof value === "string" ? value : value.id));

const price = z.object({
  id: z.string(),
  lookup_key: z.string().nullable(),
  metadata: z.record(z.string(), z.string()),
  currency: z.string(),
  unit_amount: z.number().nullable(),
  tax_behavior: z.string().nullable(),
  recurring: z.object({ interval: z.string(), interval_count: z.number() }).nullable(),
  // Not returned unless expanded; the price's own currency is among them.
  currency_options: z
    .record(z.string(), z.object({ unit_amount: z.number().nullable(), tax_behavior: z.string().nullable() }))
    .optional(),
});

const subscription = z.object({
  id: z.string(),
  customer: expandable,
  status: z.string(),
  cancel_at_period_end: z.boolean(),
  canceled_at: seconds.nullable(),
  trial_end: seconds.nullable(),
  // Since the basil release the billing period belongs to each item; the
  // subscription has no current_period_end of its own.
  items: z.object({ data: z.array(z.object({ current_period_end: seconds, price })) }),
});

const checkoutSession = z.object({
  id: z.string(),
  mode: z.string(),
  status: z.string().nullable(),
  payment_status: z.string(),
  customer: expandable.nullable(),
  subscription: expandable.nullable(),
  payment_intent: expandable.nullable(),
  client_reference_id: z.string().nullable(),
  amount_total: z.number().nullable(),
  currency: z.string().nullable(),
  // Includable only: retrieved with expand ["line_items"]. A line item's
  // price is always the full object.
  line_items: z.object({ data: z.array(z.object({ price: price.nullable() })) }).optional(),
});

const openedSession = z.object({ id: z.string(), url: z.string().nullable() });

const charge = z.object({
  id: z.string(),
  payment_intent: expandable.nullable(),
  refunded: z.boolean(),
});

/** Since basil an invoice names its subscription under parent.subscription_details. */
const invoice = z.object({
  id: z.string(),
  parent: z.object({ subscription_details: z.object({ subscription: expandable }).nullable() }).nullable(),
});

/**
 * An event's envelope. The object is only asked for its id here — some
 * objects (a balance, tax settings) have none — and, for an invoice, read
 * again as one. Every Stripe object names its kind in `object`.
 */
const event = z.object({
  id: z.string(),
  type: z.string(),
  created: seconds,
  data: z.object({ object: z.object({ object: z.string(), id: z.unknown().optional() }) }),
});

const customer = z.object({ id: z.string().regex(/^cus_[A-Za-z0-9]+$/) });
const portalSession = z.object({ url: z.string() });
const priceList = z.object({ data: z.array(price), has_more: z.boolean() });

/** Exported for tests/stripe-shapes, which holds them against the SDK's types. */
export const stripeWire = {
  price,
  subscription,
  checkoutSession,
  openedSession,
  charge,
  invoice,
  event,
  customer,
  portalSession,
  priceList,
} as const;

// --- normalising ---------------------------------------------------------------------

function referenceOf(wire: z.infer<typeof price>): PriceReference {
  return {
    priceId: wire.id,
    lookupKey: wire.lookup_key,
    planCode: wire.metadata.plan_code ?? null,
    passDays: wire.metadata.pass_days ?? null,
  };
}

/** A Price and each of its currency options, one entry per currency, the Price's own first. */
function pricesOf(wire: z.infer<typeof price>): NormalizedPrice[] {
  const shared = {
    ...referenceOf(wire),
    recurring: wire.recurring ? { interval: wire.recurring.interval, intervalCount: wire.recurring.interval_count } : null,
  };
  const entries: NormalizedPrice[] = [
    { ...shared, currency: wire.currency, unitAmountMinor: wire.unit_amount, taxBehavior: wire.tax_behavior },
  ];
  for (const [currency, option] of Object.entries(wire.currency_options ?? {})) {
    if (currency === wire.currency) continue;
    entries.push({
      ...shared,
      currency,
      unitAmountMinor: option.unit_amount,
      // An option without its own behaviour is taxed as the Price is.
      taxBehavior: option.tax_behavior ?? wire.tax_behavior,
    });
  }
  return entries;
}

/** A subscription as the webhook reads it: its one item's Price and period. */
function subscriptionFrom(wire: z.infer<typeof subscription>): NormalizedSubscription {
  const item = wire.items.data[0];
  if (item === undefined) throw new BillingProviderError("stripe_invalid_response");

  return {
    id: wire.id,
    customerId: wire.customer,
    status: wire.status,
    price: referenceOf(item.price),
    currentPeriodEnd: dateOf(item.current_period_end),
    cancelAtPeriodEnd: wire.cancel_at_period_end,
    trialEnd: dateOf(wire.trial_end),
    canceledAt: dateOf(wire.canceled_at),
  };
}

const OBJECT_ID = /^[a-z]+_[A-Za-z0-9_]+$/;

function verifiedEventFrom(raw: unknown): VerifiedEvent | null {
  const envelope = event.safeParse(raw);
  if (!envelope.success) return null;
  const id = stripeEventIdSchema.safeParse(envelope.data.id);
  if (!id.success) return null;

  const objectIdValue = envelope.data.data.object.id;
  const objectId = typeof objectIdValue === "string" && OBJECT_ID.test(objectIdValue) ? objectIdValue : null;

  let subscriptionId: string | null = null;
  if (envelope.data.type.startsWith("customer.subscription.")) {
    subscriptionId = objectId;
  } else if (envelope.data.type.startsWith("invoice.")) {
    // Read again, as an invoice: the envelope schema stripped everything but the id.
    const asInvoice = invoice.safeParse((raw as { data: { object: unknown } }).data.object);
    subscriptionId = asInvoice.success ? (asInvoice.data.parent?.subscription_details?.subscription ?? null) : null;
  }

  return {
    id: id.data,
    type: envelope.data.type,
    created: new Date(envelope.data.created * 1000),
    objectId,
    subscriptionId: stripeSubscriptionIdSchema.safeParse(subscriptionId).success ? subscriptionId : null,
  };
}

// --- the provider --------------------------------------------------------------------

function accept<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BillingProviderError("billing_invalid_input");
  return parsed.data;
}

/** One call: Stripe's failure as a closed code, Stripe's answer held to its schema. */
async function call<T>(request: () => Promise<unknown>, schema: z.ZodType<T>): Promise<T> {
  let response: unknown;
  try {
    response = await request();
  } catch (error) {
    throw billingErrorFrom(error);
  }
  const parsed = schema.safeParse(response);
  if (!parsed.success) throw new BillingProviderError("stripe_invalid_response");
  return parsed.data;
}

export interface StripeProviderOptions {
  readonly secretKey: string;
  /** Null where no webhook is served (the price sync); then nothing verifies. */
  readonly webhookSecret: string | null;
  /** For tests: an SDK-shaped client in place of the real one. */
  readonly client?: StripeClient;
}

export function createStripeProvider(options: StripeProviderOptions): BillingProvider {
  const client: StripeClient = options.client ?? createStripeClient(options.secretKey);
  const webhookSecret = options.webhookSecret;

  return {
    async createCustomer(input) {
      const { learnerId } = accept(customerInputSchema, input);
      // No email, no name, no address: Checkout collects what a payment
      // needs, on Stripe's page, and none of it comes back here (spec S10).
      const created = await call(
        () => client.customers.create({ metadata: { learner_id: learnerId } }, { idempotencyKey: `customer-${learnerId}` }),
        customer,
      );
      return { customerId: created.id };
    },

    async createCheckoutSession(input) {
      const order = accept(checkoutSessionInputSchema, input);

      const params: Stripe.Checkout.SessionCreateParams = {
        mode: order.mode,
        customer: order.customerId,
        line_items: [{ price: order.priceId, quantity: 1 }],
        // Founding-member and partner codes (spec S6).
        allow_promotion_codes: true,
        locale: "en",
        automatic_tax: { enabled: order.automaticTax },
        custom_text: { submit: { message: order.submitMessage } },
        success_url: order.successUrl,
        cancel_url: order.cancelUrl,
        client_reference_id: order.clientReferenceId,
        // No list of payment method types: the methods offered are the Dashboard's
        // dynamic payment methods, so cards, wallets, Klarna, SEPA and PayPal
        // are switched on and off without a deploy, and each learner sees only
        // what works for their country, currency and mode.
      };

      if (order.automaticTax) {
        // Stripe Tax needs the customer's address; Checkout collects it and
        // keeps it on the customer in Stripe. It never comes back here.
        params.customer_update = { address: "auto" };
      }
      if (order.mode === "payment") {
        // A one-off purchase gets an invoice, as a subscription's charges do.
        params.invoice_creation = { enabled: true };
      }
      if (order.trial !== null) {
        // The one trial: no card collected, and no charge at its end — a
        // trial that cannot become a payment places no order (spec S6). The
        // webhook also sets it to cancel at its end on first sight, which
        // holds even if a card is added later; missing_payment_method only
        // acts when there is none.
        params.payment_method_collection = "if_required";
        params.subscription_data = {
          trial_period_days: order.trial.days,
          trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        };
        // Short-lived, so an abandoned trial session cannot be completed a
        // day later beside a second one.
        params.expires_at = Math.floor(Date.now() / 1000) + TRIAL_CHECKOUT_LIFETIME_SECONDS;
      }

      // One order is one session: a second press of the button, or a retry
      // after a timeout, gets the session the first one made.
      const session = await call(
        () => client.checkout.sessions.create(params, { idempotencyKey: `checkout-${order.clientReferenceId}` }),
        openedSession,
      );
      if (session.url === null) throw new BillingProviderError("stripe_invalid_response");
      return { id: session.id, url: session.url };
    },

    async createPortalSession(input) {
      const { customerId, returnUrl } = accept(portalSessionInputSchema, input);
      const portal = await call(
        () => client.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl }),
        portalSession,
      );
      return { url: portal.url };
    },

    async verifyWebhook(rawBody, signature) {
      // No secret, no verification, and so no event: failing closed is the
      // only reading of a webhook nobody can authenticate.
      if (webhookSecret === null || !signature) return null;

      let raw: unknown;
      try {
        // The SDK checks the HMAC over the raw body and that the timestamp
        // is within its tolerance (five minutes), so a captured event cannot
        // be replayed later. Its error says why; nobody downstream needs to.
        raw = client.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch {
        return null;
      }
      return verifiedEventFrom(raw);
    },

    async retrieveSubscription(id) {
      const subscriptionId = accept(subscriptionIdInput, id);
      return subscriptionFrom(await call(() => client.subscriptions.retrieve(subscriptionId), subscription));
    },

    async cancelAtPeriodEnd(id) {
      const subscriptionId = accept(subscriptionIdInput, id);
      // No idempotency key of our own: setting a flag to true is idempotent
      // by nature, and a key would make a second, needed application within
      // a day return the first answer instead of applying again. The SDK
      // keys its own retries.
      return subscriptionFrom(
        await call(() => client.subscriptions.update(subscriptionId, { cancel_at_period_end: true }), subscription),
      );
    },

    async retrieveCheckoutSession(id) {
      const sessionId = accept(checkoutSessionIdInput, id);
      const wire = await call(
        () => client.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] }),
        checkoutSession,
      );
      const linePrice = wire.line_items?.data[0]?.price ?? null;

      return {
        id: wire.id,
        mode: wire.mode,
        status: wire.status,
        paymentStatus: wire.payment_status,
        customerId: wire.customer,
        subscriptionId: wire.subscription,
        paymentIntentId: wire.payment_intent,
        clientReferenceId: wire.client_reference_id,
        amountTotalMinor: wire.amount_total,
        currency: wire.currency,
        price: linePrice === null ? null : referenceOf(linePrice),
      };
    },

    async retrieveCharge(id) {
      const chargeId = accept(chargeIdInput, id);
      const wire = await call(() => client.charges.retrieve(chargeId), charge);
      return { id: wire.id, paymentIntentId: wire.payment_intent, refunded: wire.refunded };
    },

    async listPrices(lookupKeys) {
      const keys = accept(lookupKeysInput, [...lookupKeys]);
      const list = await call(
        () =>
          client.prices.list({
            lookup_keys: keys,
            active: true,
            limit: 100,
            expand: ["data.currency_options"],
          }),
        priceList,
      );
      // A lookup key names one Price, so ten keys cannot fill a page of a
      // hundred. A page that says there is more is not the list asked for.
      if (list.has_more) throw new BillingProviderError("stripe_invalid_response");
      return list.data.flatMap(pricesOf);
    },
  };
}
