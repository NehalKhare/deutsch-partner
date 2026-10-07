import { z } from "zod";

import {
  OFFER_KINDS,
  OFFERS,
  PASS_DAYS_MAX,
  TRIAL_PLAN,
  billingIntervalSchema,
  offerKeySchema,
  subscriptionStatusSchema,
  type CompGrant,
  type OfferKey,
  type PassGrant,
  type SubscriptionGrant,
} from "@dp/domain/billing";
import { paidPlanCodeSchema } from "@dp/domain/plans";

import { fail, mapDatabaseError, ok, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import type { DatabaseClient, QueryResponse } from "./types";

/**
 * Plans and payments, from both sides (billing-and-plans-spec.md S5, S8, S10).
 *
 * Two factories, because the two sides must never share a client:
 *
 * - the learner's, on the RLS client, reads that learner's own grants — the
 *   rows entitlement resolves from — and nothing else. It has no writes: the
 *   tables grant a learner select and nothing more.
 * - the admin one, on the secret-key client, is the webhook's and the order
 *   page's. Every method takes the learner or the Stripe id explicitly.
 *
 * What a learner has is decided by `resolveEntitlement` in the domain over
 * rows read here, never by this module. Stripe ids are held to their prefixes
 * on the way in, as the columns hold them, so a malformed id is refused
 * before a query rather than by a constraint after one. Nothing here reads or
 * stores a card, an address, a name or an email.
 */

const CUSTOMERS = "billing_customers";
const CHECKOUTS = "billing_checkouts";
const SUBSCRIPTIONS = "subscriptions";
const PASSES = "plan_passes";
const COMPS = "plan_comps";
const PRICES = "billing_prices";
const EVENTS = "billing_events";

/**
 * How many subscription or pass rows one read returns. Far above what one
 * learner accumulates; below what a runaway loop in a webhook would.
 */
export const BILLING_ROWS_READ = 100;

const timestamp = z.coerce.date();
const instant = z.date();
const learnerIdSchema = z.uuid();

// --- Stripe's identifiers, as the columns hold them ----------------------------

export const stripeCustomerIdSchema = z.string().regex(/^cus_[A-Za-z0-9]+$/, "a Stripe customer id");
export const stripeSubscriptionIdSchema = z.string().regex(/^sub_[A-Za-z0-9]+$/, "a Stripe subscription id");
export const stripePriceIdSchema = z.string().regex(/^price_[A-Za-z0-9]+$/, "a Stripe price id");
/** Checkout Session ids carry their mode: cs_test_… and cs_live_…. */
export const stripeCheckoutSessionIdSchema = z
  .string()
  .regex(/^cs_[A-Za-z0-9_]+$/, "a Stripe Checkout Session id");
export const stripePaymentIntentIdSchema = z.string().regex(/^pi_[A-Za-z0-9]+$/, "a Stripe PaymentIntent id");
export const stripeEventIdSchema = z.string().regex(/^evt_[A-Za-z0-9_]+$/, "a Stripe event id");
export const stripeEventTypeSchema = z.string().regex(/^[a-z0-9_.]{1,100}$/, "a Stripe event type");
/** ISO 4217, lower case, as Stripe spells it. */
export const currencyCodeSchema = z.string().regex(/^[a-z]{3}$/, "a currency code");

// --- closed sets this layer owns ------------------------------------------------

/** An order placed on the order page, or Premium's one trial, which places none. */
export const CHECKOUT_KINDS = ["order", "trial"] as const;
export const checkoutKindSchema = z.enum(CHECKOUT_KINDS);
export type CheckoutKind = z.infer<typeof checkoutKindSchema>;

export const CHECKOUT_STATUSES = ["created", "opened", "completed", "expired", "failed"] as const;
export const checkoutStatusSchema = z.enum(CHECKOUT_STATUSES);
export type CheckoutStatus = z.infer<typeof checkoutStatusSchema>;

export const TAX_BEHAVIORS = ["inclusive", "exclusive", "unspecified"] as const;
export const taxBehaviorSchema = z.enum(TAX_BEHAVIORS);

/** How a webhook event can end. `received` is how it starts. */
export const FINISHED_EVENT_STATUSES = ["processed", "failed", "ignored"] as const;
export const finishedEventStatusSchema = z.enum(FINISHED_EVENT_STATUSES);
export type FinishedEventStatus = z.infer<typeof finishedEventStatusSchema>;

/**
 * Why an event failed or was ignored, as a code. Never a sentence: Stripe's
 * messages can carry an email or a card's last four, and the column refuses
 * anything but this shape (spec S13).
 */
export const eventErrorCodeSchema = z.string().regex(/^[a-z0-9_]{1,60}$/, "an error code");

/**
 * What claiming an event found. `new` and `retry` mean apply it — every
 * application is idempotent — and `processed` means acknowledge and stop.
 */
export const EVENT_CLAIMS = ["new", "processed", "retry"] as const;
export type EventClaim = (typeof EVENT_CLAIMS)[number];

// --- rows ---------------------------------------------------------------------------

export const billingCustomerRowSchema = z.object({
  learner_id: z.uuid(),
  stripe_customer_id: stripeCustomerIdSchema,
  created_at: timestamp,
});

export const billingCheckoutRowSchema = z.object({
  id: z.uuid(),
  learner_id: z.uuid(),
  offer_key: offerKeySchema,
  kind: checkoutKindSchema,
  terms_version: z.string(),
  early_start_consent_at: timestamp.nullable(),
  stripe_checkout_session_id: stripeCheckoutSessionIdSchema.nullable(),
  status: checkoutStatusSchema,
  created_at: timestamp,
  updated_at: timestamp,
});

export const subscriptionRowSchema = z.object({
  id: z.uuid(),
  learner_id: z.uuid(),
  stripe_subscription_id: stripeSubscriptionIdSchema,
  stripe_price_id: stripePriceIdSchema,
  plan_code: paidPlanCodeSchema,
  status: subscriptionStatusSchema,
  current_period_end: timestamp.nullable(),
  cancel_at_period_end: z.boolean(),
  trial_end: timestamp.nullable(),
  canceled_at: timestamp.nullable(),
  stripe_synced_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp,
});

export const planPassRowSchema = z.object({
  id: z.uuid(),
  learner_id: z.uuid(),
  plan_code: paidPlanCodeSchema,
  starts_at: timestamp,
  ends_at: timestamp,
  stripe_checkout_session_id: stripeCheckoutSessionIdSchema,
  stripe_payment_intent_id: stripePaymentIntentIdSchema.nullable(),
  amount_minor: z.number().int().min(0),
  currency: currencyCodeSchema,
  revoked_at: timestamp.nullable(),
  created_at: timestamp,
});

export const planCompRowSchema = z.object({
  id: z.uuid(),
  learner_id: z.uuid(),
  plan_code: paidPlanCodeSchema,
  starts_at: timestamp,
  ends_at: timestamp.nullable(),
  reason: z.string().regex(/^[a-z0-9_]{1,60}$/, "a reason code"),
  revoked_at: timestamp.nullable(),
  created_at: timestamp,
});

export const billingPriceRowSchema = z.object({
  stripe_price_id: stripePriceIdSchema,
  currency: currencyCodeSchema,
  lookup_key: offerKeySchema,
  plan_code: paidPlanCodeSchema,
  kind: z.enum(OFFER_KINDS),
  billing_interval: billingIntervalSchema.nullable(),
  pass_days: z.number().int().min(1).max(PASS_DAYS_MAX).nullable(),
  unit_amount_minor: z.number().int().min(0),
  tax_behavior: taxBehaviorSchema.nullable(),
  active: z.boolean(),
  fetched_at: timestamp,
});

/** A subscription as a learner is shown it: no Stripe ids, nothing to act on. */
export interface SubscriptionSummary {
  readonly planCode: SubscriptionGrant["planCode"];
  readonly status: SubscriptionGrant["status"];
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly trialEnd: Date | null;
  readonly canceledAt: Date | null;
  readonly createdAt: Date;
}

/** A subscription as the webhook stored it. */
export interface StoredSubscription extends SubscriptionSummary {
  readonly id: string;
  readonly learnerId: string;
  readonly stripeSubscriptionId: string;
  readonly stripePriceId: string;
  readonly syncedAt: Date;
}

const subscriptionFromRow = subscriptionRowSchema.transform(
  (row): StoredSubscription => ({
    id: row.id,
    learnerId: row.learner_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    planCode: row.plan_code,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEnd: row.trial_end,
    canceledAt: row.canceled_at,
    syncedAt: row.stripe_synced_at,
    createdAt: row.created_at,
  }),
);

/** A pass as the webhook stored it. The grant fields are entitlement's. */
export interface StoredPass extends PassGrant {
  readonly id: string;
  readonly learnerId: string;
  readonly stripeCheckoutSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly createdAt: Date;
}

const passFromRow = planPassRowSchema.transform(
  (row): StoredPass => ({
    id: row.id,
    learnerId: row.learner_id,
    planCode: row.plan_code,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    revokedAt: row.revoked_at,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    createdAt: row.created_at,
  }),
);

// The learner's reads name their columns: what entitlement and display need,
// and so what the RLS client is ever asked for.

const subscriptionGrantShape = subscriptionRowSchema.pick({
  plan_code: true,
  status: true,
  current_period_end: true,
  cancel_at_period_end: true,
  trial_end: true,
});

const subscriptionGrantFromRow = subscriptionGrantShape.transform(
  (row): SubscriptionGrant => ({
    planCode: row.plan_code,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEnd: row.trial_end,
  }),
);

const subscriptionSummaryShape = subscriptionRowSchema.pick({
  plan_code: true,
  status: true,
  current_period_end: true,
  cancel_at_period_end: true,
  trial_end: true,
  canceled_at: true,
  created_at: true,
});

const subscriptionSummaryFromRow = subscriptionSummaryShape.transform(
  (row): SubscriptionSummary => ({
    planCode: row.plan_code,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEnd: row.trial_end,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
  }),
);

const passGrantShape = planPassRowSchema.pick({
  plan_code: true,
  starts_at: true,
  ends_at: true,
  revoked_at: true,
});

const passGrantFromRow = passGrantShape.transform(
  (row): PassGrant => ({
    planCode: row.plan_code,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    revokedAt: row.revoked_at,
  }),
);

const compGrantShape = planCompRowSchema.pick({
  plan_code: true,
  starts_at: true,
  ends_at: true,
  revoked_at: true,
});

const compGrantFromRow = compGrantShape.transform(
  (row): CompGrant => ({
    planCode: row.plan_code,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    revokedAt: row.revoked_at,
  }),
);

const columnsOf = (schema: z.ZodObject) => Object.keys(schema.shape).join(", ");

// --- prices -----------------------------------------------------------------------

/**
 * One active Stripe Price in one currency, as the sync mirrors it.
 *
 * Held to the offer its lookup key names: a Price whose metadata says Plus
 * under Premium's key, or a pass with an interval, is refused whole rather
 * than put on the pricing page. What it costs is Stripe's figure in integer
 * minor units, VAT inclusive (spec S7).
 */
export const billingPriceInputSchema = z
  .object({
    stripePriceId: stripePriceIdSchema,
    currency: currencyCodeSchema,
    lookupKey: offerKeySchema,
    planCode: paidPlanCodeSchema,
    kind: z.enum(OFFER_KINDS),
    interval: billingIntervalSchema.nullable(),
    passDays: z.number().int().min(1).max(PASS_DAYS_MAX).nullable(),
    // The column is a 32-bit integer.
    unitAmountMinor: z.number().int().min(0).max(2_147_483_647),
    taxBehavior: taxBehaviorSchema.nullable(),
  })
  .superRefine((row, ctx) => {
    const offer = OFFERS[row.lookupKey];
    if (offer.plan !== row.planCode || offer.kind !== row.kind || offer.interval !== row.interval) {
      ctx.addIssue({ code: "custom", message: "the price does not match its offer", path: ["lookupKey"] });
    }
    if ((row.kind === "pass") !== (row.passDays !== null)) {
      ctx.addIssue({ code: "custom", message: "a pass, and only a pass, has a length", path: ["passDays"] });
    }
  });

export type BillingPriceInput = z.infer<typeof billingPriceInputSchema>;

export interface BillingPrice extends BillingPriceInput {
  readonly active: boolean;
  readonly fetchedAt: Date;
}

const priceFromRow = billingPriceRowSchema.transform(
  (row): BillingPrice => ({
    stripePriceId: row.stripe_price_id,
    currency: row.currency,
    lookupKey: row.lookup_key,
    planCode: row.plan_code,
    kind: row.kind,
    interval: row.billing_interval,
    passDays: row.pass_days,
    unitAmountMinor: row.unit_amount_minor,
    taxBehavior: row.tax_behavior,
    active: row.active,
    fetchedAt: row.fetched_at,
  }),
);

const priceListSchema = z
  .array(billingPriceInputSchema)
  .max(500)
  .refine(
    (rows) => new Set(rows.map((row) => `${row.stripePriceId}/${row.currency}`)).size === rows.length,
    "one row per price and currency",
  );

// --- inputs -----------------------------------------------------------------------

const newCheckoutSchema = z
  .object({
    learnerId: learnerIdSchema,
    offerKey: offerKeySchema,
    // A trial is opened through openTrialCheckout, which holds it to one per
    // learner; this path records paid orders only.
    kind: z.literal("order"),
    termsVersion: z.string().min(1).max(40),
    earlyStartConsentAt: instant.nullable(),
  })
  .refine((input) => input.earlyStartConsentAt !== null, {
    // The row is the evidence of the consent (spec S6, S11). No consent, no
    // row, and so no Checkout Session.
    message: "an order records the early-start consent",
    path: ["earlyStartConsentAt"],
  });

export type NewCheckout = z.infer<typeof newCheckoutSchema>;

const trialCheckoutSchema = z
  .object({
    learnerId: learnerIdSchema,
    offerKey: offerKeySchema,
    termsVersion: z.string().min(1).max(40),
    /** How long the Checkout Session can be completed for: the provider's lifetime for it. */
    openForSeconds: z.number().int().min(60).max(86_400),
  })
  .refine(
    (input) => OFFERS[input.offerKey].plan === TRIAL_PLAN && OFFERS[input.offerKey].kind === "subscription",
    { message: "the only trial is Premium's", path: ["offerKey"] },
  );

export type NewTrialCheckout = z.infer<typeof trialCheckoutSchema>;

/** What asking for the trial came to (billing_open_trial_checkout). */
export type TrialCheckoutOpening =
  | { readonly status: "created"; readonly id: string }
  /** A trial checkout that could still be completed is open; a second would be a second trial. */
  | { readonly status: "open" }
  /** The trial was had, or the learner has subscribed before. */
  | { readonly status: "used" };

const trialOpeningSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), id: z.uuid() }),
  z.object({ status: z.literal("open") }),
  z.object({ status: z.literal("used") }),
]);

const subscriptionRecordSchema = z.object({
  learnerId: learnerIdSchema,
  stripeSubscriptionId: stripeSubscriptionIdSchema,
  stripePriceId: stripePriceIdSchema,
  planCode: paidPlanCodeSchema,
  status: subscriptionStatusSchema,
  currentPeriodEnd: instant.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trialEnd: instant.nullable(),
  canceledAt: instant.nullable(),
  /** When the subscription was retrieved from Stripe. An older read never overwrites a newer one. */
  syncedAt: instant,
});

export type SubscriptionRecord = z.infer<typeof subscriptionRecordSchema>;

/**
 * A paid pass, as the webhook hands it over. Where its window falls is the
 * database's to decide (billing_grant_pass): it stacks after the learner's
 * running pass of the same plan, under a lock, so the caller says only how
 * long it lasts and when it was paid for.
 */
const newPassSchema = z.object({
  learnerId: learnerIdSchema,
  planCode: paidPlanCodeSchema,
  days: z.number().int().min(1).max(PASS_DAYS_MAX),
  /** When it was paid for: the earliest it can start. */
  at: instant,
  stripeCheckoutSessionId: stripeCheckoutSessionIdSchema,
  stripePaymentIntentId: stripePaymentIntentIdSchema.nullable(),
  amountMinor: z.number().int().min(0).max(2_147_483_647),
  currency: currencyCodeSchema,
});

export type NewPass = z.infer<typeof newPassSchema>;

const claimSchema = z.object({
  eventId: stripeEventIdSchema,
  type: stripeEventTypeSchema,
  createdAt: instant,
});

const finishSchema = z
  .object({
    eventId: stripeEventIdSchema,
    status: finishedEventStatusSchema,
    errorCode: eventErrorCodeSchema.nullable(),
    at: instant,
  })
  .refine((input) => input.status !== "failed" || input.errorCode !== null, {
    // A failure with no code is one nobody can act on.
    message: "a failure carries a code",
    path: ["errorCode"],
  });

// --- results ------------------------------------------------------------------------

export interface LearnerBillingGrants {
  /** Null until the learner's first checkout creates one. */
  readonly customerId: string | null;
  readonly subscriptions: readonly SubscriptionGrant[];
  readonly passes: readonly PassGrant[];
  readonly comps: readonly CompGrant[];
  /** Any subscription row at all, in any status: what trial eligibility asks. */
  readonly hasEverSubscribed: boolean;
}

export interface SubscriptionChange {
  /** Null on the subscription's first write. */
  readonly before: StoredSubscription | null;
  readonly after: StoredSubscription;
  /** False when the stored row came from a newer read, which was kept. */
  readonly applied: boolean;
}

const subscriptionChangeSchema = z.object({
  before: subscriptionFromRow.nullable(),
  after: subscriptionFromRow,
  applied: z.boolean(),
});

export interface PassGranted {
  readonly pass: StoredPass;
  /** False for a redelivery: the pass was already granted, as it is shown. */
  readonly created: boolean;
}

const passGrantedSchema = z.object({ pass: passFromRow, created: z.boolean() });

export interface RevokedPass {
  readonly id: string;
  readonly learnerId: string;
  readonly planCode: PassGrant["planCode"];
}

const revokedSchema = z
  .object({ id: z.uuid(), learner_id: z.uuid(), plan_code: paidPlanCodeSchema })
  .transform((row): RevokedPass => ({ id: row.id, learnerId: row.learner_id, planCode: row.plan_code }));

/** The offer a Price was sold as, from the mirror: active or not, it is the record. */
export interface PriceOffer {
  readonly lookupKey: OfferKey;
  readonly passDays: number | null;
}

const priceOfferSchema = billingPriceRowSchema
  .pick({ lookup_key: true, pass_days: true })
  .transform((row): PriceOffer => ({ lookupKey: row.lookup_key, passDays: row.pass_days }));

/** What a subscription was last stored as: enough to keep its plan through an event whose Price we cannot place. */
export interface StoredSubscriptionPlan {
  readonly planCode: SubscriptionGrant["planCode"];
  readonly stripePriceId: string;
}

const storedPlanSchema = subscriptionRowSchema
  .pick({ plan_code: true, stripe_price_id: true })
  .transform((row): StoredSubscriptionPlan => ({ planCode: row.plan_code, stripePriceId: row.stripe_price_id }));

export interface PricesReplaced {
  readonly upserted: number;
  /** Prices Stripe no longer lists as active, kept and marked inactive. */
  readonly deactivated: number;
}

const pricesReplacedSchema = z.object({
  upserted: z.coerce.number().int().min(0),
  deactivated: z.coerce.number().int().min(0),
});

// --- helpers ------------------------------------------------------------------------

const iso = (value: Date | null) => (value === null ? null : value.toISOString());

/** Rows that came back from a write, as a yes or no: did it find its row. */
function touched(outcome: QueryResponse): RepositoryResult<boolean> {
  if (outcome.error) return fail(mapDatabaseError(outcome.error));
  return ok(Array.isArray(outcome.data) && outcome.data.length > 0);
}

/** One optional column of one optional row. */
async function maybeValue<T>(
  query: PromiseLike<QueryResponse>,
  schema: z.ZodType<T>,
): Promise<RepositoryResult<T | null>> {
  const outcome = await query;
  if (outcome.error) return fail(mapDatabaseError(outcome.error));
  if (outcome.data === null || outcome.data === undefined) return ok(null);
  const parsed = schema.safeParse(outcome.data);
  return parsed.success ? ok(parsed.data) : fail(repositoryError("invalid_data", parsed.error));
}

// --- the learner's side ---------------------------------------------------------------

export interface LearnerBillingRepository {
  /** Everything entitlement resolves from, for one learner. RLS keeps it to their own. */
  grantsFor(learnerId: string): Promise<RepositoryResult<LearnerBillingGrants>>;
  /** Subscriptions for display, newest first. */
  subscriptionsFor(learnerId: string): Promise<RepositoryResult<readonly SubscriptionSummary[]>>;
}

export function createLearnerBillingRepository(client: DatabaseClient): LearnerBillingRepository {
  return {
    async grantsFor(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;

      // The ownership filter is RLS's to enforce; it is also here so the query
      // uses the learner index and states what it is for.
      const [customer, subscriptions, passes, comps] = await Promise.all([
        maybeValue(
          client.from(CUSTOMERS).select("stripe_customer_id").eq("learner_id", id.data).maybeSingle(),
          z.object({ stripe_customer_id: stripeCustomerIdSchema }).transform((row) => row.stripe_customer_id),
        ),
        client
          .from(SUBSCRIPTIONS)
          .select(columnsOf(subscriptionGrantShape))
          .eq("learner_id", id.data)
          .order("created_at", { ascending: false })
          .limit(BILLING_ROWS_READ),
        client
          .from(PASSES)
          .select(columnsOf(passGrantShape))
          .eq("learner_id", id.data)
          .order("ends_at", { ascending: false })
          .limit(BILLING_ROWS_READ),
        client
          .from(COMPS)
          .select(columnsOf(compGrantShape))
          .eq("learner_id", id.data)
          .order("starts_at", { ascending: false })
          .limit(BILLING_ROWS_READ),
      ]);
      if (!customer.ok) return customer;

      const subscriptionRows = decodeRows(subscriptions, subscriptionGrantFromRow);
      if (!subscriptionRows.ok) return subscriptionRows;
      const passRows = decodeRows(passes, passGrantFromRow);
      if (!passRows.ok) return passRows;
      const compRows = decodeRows(comps, compGrantFromRow);
      if (!compRows.ok) return compRows;

      return ok({
        customerId: customer.data,
        subscriptions: subscriptionRows.data,
        passes: passRows.data,
        comps: compRows.data,
        hasEverSubscribed: subscriptionRows.data.length > 0,
      });
    },

    async subscriptionsFor(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;

      const outcome = await client
        .from(SUBSCRIPTIONS)
        .select(columnsOf(subscriptionSummaryShape))
        .eq("learner_id", id.data)
        .order("created_at", { ascending: false })
        .limit(BILLING_ROWS_READ);

      return decodeRows(outcome, subscriptionSummaryFromRow);
    },
  };
}

// --- the webhook's and the order page's side -------------------------------------------

export interface BillingAdminRepository {
  /** The learner's Stripe customer, or null before their first checkout. */
  customerFor(learnerId: string): Promise<RepositoryResult<string | null>>;
  /**
   * Maps the learner to a customer, once. Returns the stored customer, which
   * is an earlier one when a second checkout raced the first: the caller
   * uses what comes back, not what it passed.
   */
  saveCustomer(learnerId: string, stripeCustomerId: string): Promise<RepositoryResult<string>>;
  /** The learner behind a customer, or null for one this application never created. */
  learnerForCustomer(stripeCustomerId: string): Promise<RepositoryResult<string | null>>;

  /** Records a paid order before any Checkout Session exists. Returns its id. */
  createCheckout(input: NewCheckout): Promise<RepositoryResult<string>>;
  /**
   * Records the learner's one trial checkout, or says it is open or used —
   * decided under a per-learner lock, so concurrent presses open one session.
   */
  openTrialCheckout(input: NewTrialCheckout): Promise<RepositoryResult<TrialCheckoutOpening>>;
  /** Marks a checkout whose Checkout Session never opened as failed. False when it had opened, or is unknown. */
  abandonCheckout(checkoutId: string): Promise<RepositoryResult<boolean>>;
  /** False when there is no such checkout. */
  attachCheckoutSession(checkoutId: string, stripeCheckoutSessionId: string): Promise<RepositoryResult<boolean>>;
  /** False when no checkout carries that session. */
  setCheckoutStatus(stripeCheckoutSessionId: string, status: CheckoutStatus): Promise<RepositoryResult<boolean>>;

  upsertSubscription(record: SubscriptionRecord): Promise<RepositoryResult<SubscriptionChange>>;
  /** The plan and Price a subscription was last stored with, or null for one never stored. */
  storedSubscription(stripeSubscriptionId: string): Promise<RepositoryResult<StoredSubscriptionPlan | null>>;
  /**
   * A learner's subscriptions that could still bill: every row not yet
   * canceled, with the Stripe ids. For account deletion, which must cancel
   * them first (spec S10).
   */
  liveSubscriptionsFor(learnerId: string): Promise<RepositoryResult<readonly StoredSubscription[]>>;

  /** Idempotent on the Checkout Session. */
  grantPass(pass: NewPass): Promise<RepositoryResult<PassGranted>>;
  /** Null when nothing was left to revoke. */
  revokePassByPaymentIntent(paymentIntentId: string, at: Date): Promise<RepositoryResult<RevokedPass | null>>;
  /** A learner's passes, latest ending first: what stacking the next one needs. */
  passesFor(learnerId: string): Promise<RepositoryResult<readonly StoredPass[]>>;

  claimEvent(event: { readonly eventId: string; readonly type: string; readonly createdAt: Date }): Promise<
    RepositoryResult<EventClaim>
  >;
  /** False when the event was never claimed. */
  finishEvent(
    eventId: string,
    status: FinishedEventStatus,
    errorCode?: string | null,
    at?: Date,
  ): Promise<RepositoryResult<boolean>>;

  /** Replaces the mirror with Stripe's active prices, in one transaction. */
  replacePrices(rows: readonly BillingPriceInput[], fetchedAt: Date): Promise<RepositoryResult<PricesReplaced>>;
  /** What the pricing page shows, by offer and currency. */
  activePrices(): Promise<RepositoryResult<readonly BillingPrice[]>>;
  /**
   * The offer a Price was mirrored under, active or not. A price change in
   * Stripe moves the lookup key to a new Price and leaves subscribers on the
   * old one, whose key Stripe then reports as null; the mirror still knows.
   */
  priceOffer(stripePriceId: string): Promise<RepositoryResult<PriceOffer | null>>;
}

export function createBillingAdminRepository(client: DatabaseClient): BillingAdminRepository {
  const customerFor = async (learnerId: string): Promise<RepositoryResult<string | null>> => {
    const id = decodeInput(learnerId, learnerIdSchema);
    if (!id.ok) return id;
    return maybeValue(
      client.from(CUSTOMERS).select("stripe_customer_id").eq("learner_id", id.data).maybeSingle(),
      z.object({ stripe_customer_id: stripeCustomerIdSchema }).transform((row) => row.stripe_customer_id),
    );
  };

  return {
    customerFor,

    async saveCustomer(learnerId, stripeCustomerId) {
      const input = decodeInput(
        { learnerId, stripeCustomerId },
        z.object({ learnerId: learnerIdSchema, stripeCustomerId: stripeCustomerIdSchema }),
      );
      if (!input.ok) return input;

      // Insert-if-absent on the learner. A customer already mapped to another
      // learner is a unique violation, reported as a conflict: one customer
      // is one learner's, which is what makes it safe to find a learner by.
      const saved = await client
        .from(CUSTOMERS)
        .upsert(
          { learner_id: input.data.learnerId, stripe_customer_id: input.data.stripeCustomerId },
          { onConflict: "learner_id", ignoreDuplicates: true },
        );
      if (saved.error) return fail(mapDatabaseError(saved.error));

      const stored = await customerFor(input.data.learnerId);
      if (!stored.ok) return stored;
      return stored.data === null ? fail(repositoryError("unavailable")) : ok(stored.data);
    },

    async learnerForCustomer(stripeCustomerId) {
      const id = decodeInput(stripeCustomerId, stripeCustomerIdSchema);
      if (!id.ok) return id;
      return maybeValue(
        client.from(CUSTOMERS).select("learner_id").eq("stripe_customer_id", id.data).maybeSingle(),
        z.object({ learner_id: z.uuid() }).transform((row) => row.learner_id),
      );
    },

    async createCheckout(checkout) {
      const input = decodeInput(checkout, newCheckoutSchema);
      if (!input.ok) return input;

      const outcome = await client
        .from(CHECKOUTS)
        .insert({
          learner_id: input.data.learnerId,
          offer_key: input.data.offerKey,
          kind: input.data.kind,
          terms_version: input.data.termsVersion,
          early_start_consent_at: iso(input.data.earlyStartConsentAt),
        })
        .select("id")
        .single();

      const row = decodeRow(outcome, z.object({ id: z.uuid() }));
      return row.ok ? ok(row.data.id) : row;
    },

    async openTrialCheckout(trial) {
      const input = decodeInput(trial, trialCheckoutSchema);
      if (!input.ok) return input;

      const outcome = await client.rpc("billing_open_trial_checkout", {
        p_learner_id: input.data.learnerId,
        p_offer_key: input.data.offerKey,
        p_terms_version: input.data.termsVersion,
        p_open_for_seconds: input.data.openForSeconds,
      });

      return decodeRow(outcome, trialOpeningSchema);
    },

    async abandonCheckout(checkoutId) {
      const id = decodeInput(checkoutId, z.uuid());
      if (!id.ok) return id;

      return touched(
        await client
          .from(CHECKOUTS)
          .update({ status: "failed" })
          .eq("id", id.data)
          .eq("status", "created")
          .select("id"),
      );
    },

    async attachCheckoutSession(checkoutId, stripeCheckoutSessionId) {
      const input = decodeInput(
        { checkoutId, stripeCheckoutSessionId },
        z.object({ checkoutId: z.uuid(), stripeCheckoutSessionId: stripeCheckoutSessionIdSchema }),
      );
      if (!input.ok) return input;

      return touched(
        await client
          .from(CHECKOUTS)
          .update({ stripe_checkout_session_id: input.data.stripeCheckoutSessionId, status: "opened" })
          .eq("id", input.data.checkoutId)
          .select("id"),
      );
    },

    async setCheckoutStatus(stripeCheckoutSessionId, status) {
      const input = decodeInput(
        { stripeCheckoutSessionId, status },
        z.object({ stripeCheckoutSessionId: stripeCheckoutSessionIdSchema, status: checkoutStatusSchema }),
      );
      if (!input.ok) return input;

      return touched(
        await client
          .from(CHECKOUTS)
          .update({ status: input.data.status })
          .eq("stripe_checkout_session_id", input.data.stripeCheckoutSessionId)
          .select("id"),
      );
    },

    async upsertSubscription(record) {
      const input = decodeInput(record, subscriptionRecordSchema);
      if (!input.ok) return input;
      const row = input.data;

      const outcome = await client.rpc("billing_upsert_subscription", {
        p_subscription: {
          learner_id: row.learnerId,
          stripe_subscription_id: row.stripeSubscriptionId,
          stripe_price_id: row.stripePriceId,
          plan_code: row.planCode,
          status: row.status,
          current_period_end: iso(row.currentPeriodEnd),
          cancel_at_period_end: row.cancelAtPeriodEnd,
          trial_end: iso(row.trialEnd),
          canceled_at: iso(row.canceledAt),
          stripe_synced_at: row.syncedAt.toISOString(),
        },
      });

      return decodeRow(outcome, subscriptionChangeSchema);
    },

    async liveSubscriptionsFor(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;
      const outcome = await client
        .from(SUBSCRIPTIONS)
        .select(columnsOf(subscriptionRowSchema))
        .eq("learner_id", id.data)
        .neq("status", "canceled")
        .limit(BILLING_ROWS_READ);
      return decodeRows(outcome, subscriptionFromRow);
    },

    async storedSubscription(stripeSubscriptionId) {
      const id = decodeInput(stripeSubscriptionId, stripeSubscriptionIdSchema);
      if (!id.ok) return id;
      return maybeValue(
        client
          .from(SUBSCRIPTIONS)
          .select("plan_code, stripe_price_id")
          .eq("stripe_subscription_id", id.data)
          .maybeSingle(),
        storedPlanSchema,
      );
    },

    async grantPass(pass) {
      const input = decodeInput(pass, newPassSchema);
      if (!input.ok) return input;
      const row = input.data;

      const outcome = await client.rpc("billing_grant_pass", {
        p_pass: {
          learner_id: row.learnerId,
          plan_code: row.planCode,
          pass_days: row.days,
          at: row.at.toISOString(),
          stripe_checkout_session_id: row.stripeCheckoutSessionId,
          stripe_payment_intent_id: row.stripePaymentIntentId,
          amount_minor: row.amountMinor,
          currency: row.currency,
        },
      });

      return decodeRow(outcome, passGrantedSchema);
    },

    async revokePassByPaymentIntent(paymentIntentId, at) {
      const input = decodeInput(
        { paymentIntentId, at },
        z.object({ paymentIntentId: stripePaymentIntentIdSchema, at: instant }),
      );
      if (!input.ok) return input;

      return maybeValue(
        client.rpc("billing_revoke_pass", {
          p_payment_intent_id: input.data.paymentIntentId,
          p_at: input.data.at.toISOString(),
        }),
        revokedSchema,
      );
    },

    async passesFor(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;

      const outcome = await client
        .from(PASSES)
        .select("*")
        .eq("learner_id", id.data)
        .order("ends_at", { ascending: false })
        .limit(BILLING_ROWS_READ);

      return decodeRows(outcome, passFromRow);
    },

    async claimEvent(event) {
      const input = decodeInput(event, claimSchema);
      if (!input.ok) return input;

      const outcome = await client.rpc("billing_claim_event", {
        p_event_id: input.data.eventId,
        p_event_type: input.data.type,
        p_created_at: input.data.createdAt.toISOString(),
      });

      return decodeRow(outcome, z.enum(EVENT_CLAIMS));
    },

    async finishEvent(eventId, status, errorCode = null, at = new Date()) {
      const input = decodeInput({ eventId, status, errorCode, at }, finishSchema);
      if (!input.ok) return input;

      return touched(
        await client
          .from(EVENTS)
          .update({
            status: input.data.status,
            error_code: input.data.errorCode,
            // A failed event is not finished: Stripe will deliver it again.
            processed_at: input.data.status === "failed" ? null : input.data.at.toISOString(),
          })
          .eq("stripe_event_id", input.data.eventId)
          .select("stripe_event_id"),
      );
    },

    async replacePrices(rows, fetchedAt) {
      const input = decodeInput({ rows, fetchedAt }, z.object({ rows: priceListSchema, fetchedAt: instant }));
      if (!input.ok) return input;

      const outcome = await client.rpc("billing_replace_prices", {
        p_prices: input.data.rows.map((row) => ({
          stripe_price_id: row.stripePriceId,
          currency: row.currency,
          lookup_key: row.lookupKey,
          plan_code: row.planCode,
          kind: row.kind,
          billing_interval: row.interval,
          pass_days: row.passDays,
          unit_amount_minor: row.unitAmountMinor,
          tax_behavior: row.taxBehavior,
        })),
        p_fetched_at: input.data.fetchedAt.toISOString(),
      });

      return decodeRow(outcome, pricesReplacedSchema);
    },

    async priceOffer(stripePriceId) {
      const id = decodeInput(stripePriceId, stripePriceIdSchema);
      if (!id.ok) return id;

      // One row per currency, all of one Price and so of one offer; any will do.
      return maybeValue(
        client
          .from(PRICES)
          .select("lookup_key, pass_days")
          .eq("stripe_price_id", id.data)
          .limit(1)
          .maybeSingle(),
        priceOfferSchema,
      );
    },

    async activePrices() {
      const outcome = await client
        .from(PRICES)
        .select("*")
        .eq("active", true)
        .order("lookup_key", { ascending: true })
        .order("currency", { ascending: true });

      return decodeRows(outcome, priceFromRow);
    },
  };
}
