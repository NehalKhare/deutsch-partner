import { z } from "zod";

import {
  stripeCheckoutSessionIdSchema,
  stripeCustomerIdSchema,
  stripePriceIdSchema,
  stripeSubscriptionIdSchema,
} from "@dp/db/billing-repository";
import { TRIAL_DAYS } from "@dp/domain/billing";

/**
 * The payment provider, as the rest of the application sees it.
 *
 * billing-and-plans-spec.md S6 to S8. One interface with two implementations:
 * Stripe's (stripe-provider.ts) and an in-memory double for tests (mock.ts).
 * Everything that crosses it is this module's own shape, never an SDK type,
 * so that the webhook, the order page and the price sync can be read — and
 * tested — without knowing how Stripe spells a field, and so that a Stripe
 * object cannot be logged whole by accident.
 *
 * What Stripe returns is reduced to what the application acts on. A
 * Checkout Session carries the customer's email and name; the normalised
 * checkout does not. Values Stripe treats as open sets (a subscription's
 * status, a session's mode) are passed through as strings for the caller to
 * judge against its own closed sets, rather than guessed at here.
 *
 * Every method rejects with a BillingProviderError (errors.ts), whose only
 * text is a code.
 */

export const CHECKOUT_MODES = ["subscription", "payment"] as const;
export type CheckoutMode = (typeof CHECKOUT_MODES)[number];

/** Stripe's limit on custom submit text. */
export const SUBMIT_MESSAGE_MAX = 1200;

/** How many lookup keys one price listing may filter on: Stripe's limit. */
export const LOOKUP_KEYS_PER_LIST = 10;

/**
 * How long a trial's Checkout Session can be completed for. Stripe's default
 * is a day, and every open trial session is a trial someone could still
 * take; the order record holds a second one back for exactly this long
 * (billing_open_trial_checkout), so it is kept short. Stripe's floor is 30
 * minutes after it creates the session; five more allow for our clock
 * running behind Stripe's.
 */
export const TRIAL_CHECKOUT_LIFETIME_SECONDS = 35 * 60;

const httpUrl = z.url({ protocol: /^https?$/ });

export const customerInputSchema = z.object({ learnerId: z.uuid() });
export type CustomerInput = z.infer<typeof customerInputSchema>;

/**
 * One order, as hosted Checkout is opened for it. The order itself was placed
 * and recorded on the order page before this is called (spec S6); the
 * reference is that record's id.
 */
export const checkoutSessionInputSchema = z
  .object({
    customerId: stripeCustomerIdSchema,
    /** The Stripe Price, as the price mirror holds it. */
    priceId: stripePriceIdSchema,
    mode: z.enum(CHECKOUT_MODES),
    /**
     * Premium's one trial. Bounded by the trial the spec sells: a longer one
     * would be a bug, not a promotion.
     */
    trial: z
      .object({ days: z.number().int().min(1).max(TRIAL_DAYS) })
      .nullable()
      .default(null),
    /** Built from APP_URL by the caller, never from a request header. */
    successUrl: httpUrl,
    cancelUrl: httpUrl,
    automaticTax: z.boolean(),
    /** The billing_checkouts row this session is for. Corroboration, never the key. */
    clientReferenceId: z.uuid(),
    /** Restates, beside Stripe's button, that the order was placed and what it costs. */
    submitMessage: z.string().min(1).max(SUBMIT_MESSAGE_MAX),
  })
  .refine((input) => input.trial === null || input.mode === "subscription", {
    message: "only a subscription has a trial",
    path: ["trial"],
  });

export type CheckoutSessionInput = z.input<typeof checkoutSessionInputSchema>;

export const portalSessionInputSchema = z.object({
  customerId: stripeCustomerIdSchema,
  returnUrl: httpUrl,
});
export type PortalSessionInput = z.infer<typeof portalSessionInputSchema>;

export const subscriptionIdInput = stripeSubscriptionIdSchema;
export const checkoutSessionIdInput = stripeCheckoutSessionIdSchema;
export const chargeIdInput = z.string().regex(/^(ch|py)_[A-Za-z0-9]+$/, "a Stripe charge id");
export const lookupKeysInput = z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/)).min(1).max(LOOKUP_KEYS_PER_LIST);

// --- what comes back ------------------------------------------------------------

/** A webhook event whose signature verified: a doorbell, not a record. */
export interface VerifiedEvent {
  /** evt_… — the inbox's key. */
  readonly id: string;
  readonly type: string;
  readonly created: Date;
  /** The object the event is about: cs_…, sub_…, in_…, ch_…. Null when it has no id. */
  readonly objectId: string | null;
  /**
   * The subscription the event concerns: the object itself for a
   * subscription event, the parent for an invoice. A reference taken from
   * the signed body — an invoice never changes which subscription it bills —
   * and never state: the subscription is always read fresh.
   */
  readonly subscriptionId: string | null;
}

/** A Price as a line item or a subscription item carries it. */
export interface PriceReference {
  readonly priceId: string;
  /** The offer, if the Price is one of ours. */
  readonly lookupKey: string | null;
  /** Metadata plan_code. Corroboration only: the lookup key decides the plan. */
  readonly planCode: string | null;
  /** Metadata pass_days, as Stripe stores metadata: a string, unvalidated. */
  readonly passDays: string | null;
}

export interface NormalizedSubscription {
  readonly id: string;
  readonly customerId: string;
  /** Stripe's status, unjudged. The webhook holds it to the domain's closed set. */
  readonly status: string;
  /** The subscription's one item's Price. This application sells one Price per subscription. */
  readonly price: PriceReference;
  /** The item's period end: in this API version the period is the item's, not the subscription's. */
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly trialEnd: Date | null;
  readonly canceledAt: Date | null;
}

export interface NormalizedCheckout {
  readonly id: string;
  readonly mode: string;
  /** open | complete | expired, as Stripe says. */
  readonly status: string | null;
  /** paid | unpaid | no_payment_required. An async method (SEPA) completes unpaid and pays later. */
  readonly paymentStatus: string;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly paymentIntentId: string | null;
  readonly clientReferenceId: string | null;
  /** What was charged, after discounts, VAT inclusive, in minor units. */
  readonly amountTotalMinor: number | null;
  readonly currency: string | null;
  /** The first line item's Price. Every order is one line. */
  readonly price: PriceReference | null;
}

export interface NormalizedCharge {
  readonly id: string;
  readonly paymentIntentId: string | null;
  /** True only when the whole charge was refunded. */
  readonly refunded: boolean;
}

/** One Price in one currency: Stripe's currency options, one entry each. */
export interface NormalizedPrice extends PriceReference {
  readonly currency: string;
  /** Null for a Price with no flat amount (tiered, customer-chosen), which is not ours. */
  readonly unitAmountMinor: number | null;
  readonly taxBehavior: string | null;
  readonly recurring: { readonly interval: string; readonly intervalCount: number } | null;
}

export interface BillingProvider {
  /** Creates the learner's Stripe customer. It carries the learner id and nothing personal. */
  createCustomer(input: CustomerInput): Promise<{ readonly customerId: string }>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<{ readonly id: string; readonly url: string }>;
  createPortalSession(input: PortalSessionInput): Promise<{ readonly url: string }>;
  /**
   * The event, if and only if the signature verifies against the webhook
   * secret. Null for anything else — a bad or stale signature, no header, no
   * secret configured — with nothing parsed, logged or stored before it.
   */
  verifyWebhook(rawBody: string, signature: string | null): Promise<VerifiedEvent | null>;
  retrieveSubscription(id: string): Promise<NormalizedSubscription>;
  /**
   * Sets a subscription to end at the end of its current period, and returns
   * it as Stripe says it is afterwards. The webhook uses it on the trial,
   * which must end at its end whatever card is added to the customer in the
   * meantime (spec S6).
   */
  cancelAtPeriodEnd(id: string): Promise<NormalizedSubscription>;
  retrieveCheckoutSession(id: string): Promise<NormalizedCheckout>;
  retrieveCharge(id: string): Promise<NormalizedCharge>;
  /** The active Prices under these lookup keys, one entry per currency. */
  listPrices(lookupKeys: readonly string[]): Promise<readonly NormalizedPrice[]>;
}
