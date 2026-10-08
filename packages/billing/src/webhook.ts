import type { BillingAdminRepository, CheckoutStatus } from "@dp/db/billing-repository";
import type { RepositoryResult } from "@dp/db/errors";
import { offerFor, passDaysSchema, subscriptionStatusSchema, type OfferKind, type SubscriptionStatus } from "@dp/domain/billing";
import type { LearnerNotificationEvent, LearnerNotificationSink, OpsNotificationSink } from "@dp/domain/notifications";
import { paidPlanCodeSchema, type PaidPlanCode } from "@dp/domain/plans";
import { withFields, type Logger } from "@dp/observability/logger";

import { isBillingProviderError } from "./errors";
import type { BillingProvider, NormalizedCheckout, PriceReference, VerifiedEvent } from "./provider";

/**
 * Applying one verified Stripe event (billing-and-plans-spec.md S8, steps
 * 2 to 4). The route verifies the signature first and hands over only what
 * verified; nothing here parses a body.
 *
 * The event is a doorbell. Which object it is about is all it is asked;
 * what that object is now is read fresh from Stripe, so an event delivered
 * late, twice or out of order cannot regress anything — the last read wins,
 * and a read is stamped before it is made so an older one can never
 * overwrite a newer one. Every write is idempotent, which is what lets a
 * failed or redelivered event simply be applied again.
 *
 * The learner is found through the Stripe customer this application created
 * for them. A Checkout reference or metadata can corroborate; it is never
 * the key. A stranger — a customer, a mode this application never opens —
 * grants nothing and is acknowledged with a code saying why. Our own
 * customer on a Price we cannot place is different: that is a Price set up
 * wrong, and acknowledging it would lose a renewal, a cancellation or a paid
 * pass, so it fails and comes back. A failure is recorded with a code and
 * answered 500, and Stripe's retry schedule is the queue.
 *
 * The log carries the event id and type, the outcome, plan codes, statuses
 * and the learner's pseudonym (spec S13). Never a Stripe object id, a learner
 * id, an amount, or any text Stripe sent.
 *
 * What changed a learner's plan is also what they are told about, through
 * the notification sink: a subscription that started or ended, a payment
 * that failed, a pass granted or refunded. Told after the write, from the
 * plan code and the status alone, and never as a reason to fail the event —
 * a learner whose nudge could not be written still has the plan. An event
 * that fails is an operator's to look at, through the other sink.
 */

export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  // Not in the list the spec began with: an expired session is how an
  // abandoned trial checkout stops holding the learner's one trial.
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

const isHandled = (type: string): type is HandledEventType =>
  (HANDLED_EVENT_TYPES as readonly string[]).includes(type);

/** What applying an event needs of the store: the admin repository's webhook half. */
export type BillingEventStore = Pick<
  BillingAdminRepository,
  | "claimEvent"
  | "finishEvent"
  | "learnerForCustomer"
  | "upsertSubscription"
  | "setCheckoutStatus"
  | "grantPass"
  | "revokePassByPaymentIntent"
  | "priceOffer"
  | "storedSubscription"
>;

export interface BillingEventDeps {
  readonly provider: Pick<
    BillingProvider,
    "retrieveSubscription" | "retrieveCheckoutSession" | "retrieveCharge" | "cancelAtPeriodEnd"
  >;
  /** The admin repository, on the secret-key client: the webhook has no session. */
  readonly repo: BillingEventStore;
  readonly logger: Logger;
  readonly now: () => Date;
  /** The learner's pseudonym for the audit trail. The id itself is never logged. */
  readonly pseudonymFor: (learnerId: string) => string;
  /** Where a learner is told what changed. Absent means nobody is told. */
  readonly notify?: LearnerNotificationSink;
  /** Where an operator is told an event is failing. Absent means nobody is told. */
  readonly alerts?: OpsNotificationSink;
}

/**
 * What the route answers. 200 for anything Stripe should not send again —
 * applied, a duplicate, or deliberately ignored — and 500 for a failure, so
 * that it does.
 */
export type BillingEventOutcome =
  | { readonly outcome: "processed" | "duplicate"; readonly httpStatus: 200 }
  | { readonly outcome: "ignored"; readonly httpStatus: 200; readonly code: string }
  | { readonly outcome: "failed"; readonly httpStatus: 500; readonly code: string };

/** How one application ended, before it is recorded. Codes fit the inbox's error_code column. */
type Applied =
  | { readonly status: "processed" }
  | { readonly status: "ignored"; readonly code: string }
  | { readonly status: "failed"; readonly code: string };

const PROCESSED: Applied = { status: "processed" };
const ignored = (code: string): Applied => ({ status: "ignored", code });
const failed = (code: string): Applied => ({ status: "failed", code });

/** A repository failure, carried out of a handler to the one place that records it. */
class StoreFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function stored<T>(result: RepositoryResult<T>): T {
  if (!result.ok) throw new StoreFailure(`store_${result.error.kind}`);
  return result.data;
}

interface Context extends BillingEventDeps {
  readonly log: Logger;
}

/** Tells the learner, if anyone is listening. A sink never throws; this makes sure. */
async function tell(ctx: Context, learnerId: string, event: LearnerNotificationEvent): Promise<void> {
  if (!ctx.notify) return;
  await ctx.notify.notify(learnerId, event).catch(() => undefined);
}

const STARTED: readonly SubscriptionStatus[] = ["active", "trialing"];
const FAILING: readonly SubscriptionStatus[] = ["past_due", "unpaid"];
const ENDED: readonly SubscriptionStatus[] = ["canceled", "incomplete_expired"];

/**
 * What a learner is told when their subscription moved from one status to
 * another, or nothing. Decided on the stored before and after, so a re-read
 * that changed nothing tells nobody anything, and a subscription first seen
 * already cancelled is not announced as having started.
 */
export function subscriptionNotice(
  before: { readonly status: SubscriptionStatus } | null,
  after: { readonly status: SubscriptionStatus; readonly planCode: PaidPlanCode },
): LearnerNotificationEvent | null {
  const was = before?.status ?? null;
  const is = after.status;
  const left = (set: readonly SubscriptionStatus[]) => was === null || !set.includes(was);

  if (STARTED.includes(is) && left(STARTED)) {
    return { kind: "billing.subscription_started", plan: after.planCode, trial: is === "trialing" };
  }
  if (FAILING.includes(is) && left(FAILING)) return { kind: "billing.payment_failed", plan: after.planCode };
  if (ENDED.includes(is) && was !== null && !ENDED.includes(was)) {
    return { kind: "billing.subscription_ended", plan: after.planCode };
  }
  return null;
}

// --- which plan a Price sells ------------------------------------------------------

interface PlacedPrice {
  readonly plan: PaidPlanCode;
  /** A pass's length, as the Price's metadata or the mirror gives it; unvalidated. */
  readonly passDays: string | number | null;
}

/**
 * The plan a Price sells, for an offer of this kind, or null.
 *
 * The lookup key first: it is what the order was placed under. But a price
 * change is a new Price that takes over the key, and Stripe then reports the
 * old Price — the one every existing subscriber is still on — with no key at
 * all. So the price mirror is asked next, by the Price's id: it keeps every
 * Price it has ever listed, active or not, as the record of what was on sale.
 * Last, for a Price whose key has gone and which the mirror never saw, the
 * plan_code bootstrap writes on each Price. A Price under someone else's
 * lookup key is someone else's offer, whatever its metadata says.
 */
async function placePrice(price: PriceReference, kind: OfferKind, ctx: Context): Promise<PlacedPrice | null> {
  const byKey = offerFor(price.lookupKey);
  if (byKey !== null) return byKey.kind === kind ? { plan: byKey.plan, passDays: price.passDays } : null;

  const recorded = stored(await ctx.repo.priceOffer(price.priceId));
  const byRecord = recorded === null ? null : offerFor(recorded.lookupKey);
  if (byRecord !== null) {
    if (byRecord.kind !== kind) return null;
    return { plan: byRecord.plan, passDays: price.passDays ?? recorded?.passDays ?? null };
  }

  if (price.lookupKey !== null) return null;
  const byMetadata = paidPlanCodeSchema.safeParse(price.planCode);
  return byMetadata.success ? { plan: byMetadata.data, passDays: price.passDays } : null;
}

// --- subscriptions ---------------------------------------------------------------

async function syncSubscription(subscriptionId: string, ctx: Context): Promise<Applied> {
  // Stamped before the read: a row stamped t is at least as new as t, so
  // refusing older stamps keeps the newest read whichever handler finishes
  // first. Stamped after, a slow handler could write an old read with a new
  // stamp.
  const syncedAt = ctx.now();
  let subscription = await ctx.provider.retrieveSubscription(subscriptionId);

  const learnerId = stored(await ctx.repo.learnerForCustomer(subscription.customerId));
  if (learnerId === null) return ignored("unknown_customer");

  // The lookup key decides the plan, then the mirror, then the Price's own
  // metadata (placePrice). Failing all three, a subscription already stored
  // on this same Price keeps the plan it was stored with, so a renewal or a
  // cancellation is still recorded.
  const placed = await placePrice(subscription.price, "subscription", ctx);
  let plan = placed?.plan ?? null;
  if (plan === null) {
    const known = stored(await ctx.repo.storedSubscription(subscription.id));
    if (known !== null && known.stripePriceId === subscription.price.priceId) plan = known.planCode;
  }
  if (plan === null) return failed("unknown_offer");

  // A status Stripe added after this was written is a failure, not a guess:
  // it is retried for days while an operator looks, and grants nothing.
  const status = subscriptionStatusSchema.safeParse(subscription.status);
  if (!status.success) return failed("unknown_status");

  // The trial is card-free and places no paid order (spec S6). Stripe's
  // missing_payment_method=cancel only acts if no card exists at its end, and
  // a card can be added in the meantime; set to cancel at its end, it cannot
  // become a charge whatever is added. Re-applied whenever it is found off.
  if (status.data === "trialing" && !subscription.cancelAtPeriodEnd) {
    subscription = await ctx.provider.cancelAtPeriodEnd(subscription.id);
    ctx.log.info("billing.trial_capped", { audit: true, userIdHash: ctx.pseudonymFor(learnerId), plan });
  }

  const change = stored(
    await ctx.repo.upsertSubscription({
      learnerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: subscription.price.priceId,
      planCode: plan,
      status: status.data,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialEnd: subscription.trialEnd,
      canceledAt: subscription.canceledAt,
      syncedAt,
    }),
  );

  const { before, after } = change;
  const moved = before === null || before.planCode !== after.planCode || before.status !== after.status;
  if (change.applied && moved) {
    ctx.log.info("billing.subscription_changed", {
      audit: true,
      userIdHash: ctx.pseudonymFor(learnerId),
      fromPlan: before?.planCode ?? null,
      toPlan: after.planCode,
      fromStatus: before?.status ?? null,
      toStatus: after.status,
      cancelAtPeriodEnd: after.cancelAtPeriodEnd,
    });
    const notice = subscriptionNotice(before, after);
    if (notice) await tell(ctx, learnerId, notice);
  } else {
    ctx.log.debug("billing.subscription_synced", { userIdHash: ctx.pseudonymFor(learnerId), applied: change.applied });
  }
  return PROCESSED;
}

// --- Checkout ------------------------------------------------------------------------

/** Corroboration: the order row this session was opened for. Its absence is noted, not fatal. */
async function markCheckout(sessionId: string, status: CheckoutStatus, ctx: Context): Promise<void> {
  const matched = stored(await ctx.repo.setCheckoutStatus(sessionId, status));
  if (!matched) ctx.log.warn("billing.checkout_unmatched", { status });
}

async function grantPass(session: NormalizedCheckout, learnerId: string, ctx: Context): Promise<Applied> {
  // A delayed method (SEPA Direct Debit) completes the session unpaid and
  // pays days later, announced by async_payment_succeeded. A promotion code
  // that covers the whole price needs no payment and is as good as paid.
  if (session.paymentStatus !== "paid" && session.paymentStatus !== "no_payment_required") {
    ctx.log.info("billing.pass_pending", { userIdHash: ctx.pseudonymFor(learnerId) });
    return PROCESSED;
  }

  // Paid for, so a Price we cannot place is retried rather than acknowledged:
  // a pass paid by SEPA on a Price whose key moved since checkout is still
  // the learner's.
  const placed = session.price === null ? null : await placePrice(session.price, "pass", ctx);
  if (placed === null) return failed("unknown_offer");

  // A paid pass with no length is a Price set up wrong. Failing keeps the
  // event coming back until the metadata is fixed, and the fresh read then
  // grants it.
  const days = passDaysSchema.safeParse(placed.passDays);
  if (!days.success) return failed("invalid_pass_days");
  if (session.amountTotalMinor === null || session.currency === null) return failed("missing_amount");

  // Idempotent on the session: a second event for the same purchase gets the
  // pass the first one granted, window and all. Where the window falls —
  // stacked after a running pass of the same plan — is decided by the
  // database under the learner's lock, so two purchases completing at once
  // queue instead of overlapping.
  const granted = stored(
    await ctx.repo.grantPass({
      learnerId,
      planCode: placed.plan,
      days: days.data,
      at: ctx.now(),
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: session.paymentIntentId,
      amountMinor: session.amountTotalMinor,
      currency: session.currency,
    }),
  );
  if (granted.created) {
    ctx.log.info("billing.pass_granted", {
      audit: true,
      userIdHash: ctx.pseudonymFor(learnerId),
      plan: granted.pass.planCode,
      days: days.data,
      startsAt: granted.pass.startsAt.toISOString(),
      endsAt: granted.pass.endsAt.toISOString(),
    });
    await tell(ctx, learnerId, {
      kind: "billing.pass_granted",
      plan: granted.pass.planCode,
      days: days.data,
      endsAt: granted.pass.endsAt,
    });
  }

  await markCheckout(session.id, "completed", ctx);
  return PROCESSED;
}

async function completeCheckout(sessionId: string, ctx: Context): Promise<Applied> {
  const session = await ctx.provider.retrieveCheckoutSession(sessionId);

  // The session's customer, which this application created for the learner
  // who placed the order. client_reference_id is never asked who that was.
  if (session.customerId === null) return ignored("unknown_customer");
  const learnerId = stored(await ctx.repo.learnerForCustomer(session.customerId));
  if (learnerId === null) return ignored("unknown_customer");

  if (session.mode !== "subscription" && session.mode !== "payment") return ignored("unsupported_mode");
  if (session.status !== "complete") return PROCESSED;

  if (session.mode === "payment") return grantPass(session, learnerId, ctx);

  if (session.subscriptionId === null) return ignored("missing_subscription");
  const applied = await syncSubscription(session.subscriptionId, ctx);
  if (applied.status === "processed") await markCheckout(session.id, "completed", ctx);
  return applied;
}

async function failCheckout(sessionId: string, ctx: Context): Promise<Applied> {
  const session = await ctx.provider.retrieveCheckoutSession(sessionId);
  // Read fresh like everything else: a session Stripe now calls paid was
  // not a failure, whatever the event said.
  if (session.paymentStatus !== "paid") await markCheckout(session.id, "failed", ctx);
  return PROCESSED;
}

// --- refunds -----------------------------------------------------------------------

async function refund(chargeId: string, ctx: Context): Promise<Applied> {
  const charge = await ctx.provider.retrieveCharge(chargeId);

  // A partial refund is a goodwill gesture, not a withdrawal: the pass stands.
  if (!charge.refunded) return ignored("partial_refund");
  if (charge.paymentIntentId === null) return ignored("no_payment_intent");

  // A refunded subscription charge matches no pass. What happens to the
  // subscription is Stripe's to say, in the subscription's own events.
  const revoked = stored(await ctx.repo.revokePassByPaymentIntent(charge.paymentIntentId, ctx.now()));
  if (revoked === null) return ignored("no_pass");

  ctx.log.info("billing.pass_revoked", {
    audit: true,
    userIdHash: ctx.pseudonymFor(revoked.learnerId),
    plan: revoked.planCode,
  });
  await tell(ctx, revoked.learnerId, { kind: "billing.pass_revoked", plan: revoked.planCode });
  return PROCESSED;
}

// --- dispatch --------------------------------------------------------------------------

const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]+$/;
const CHARGE_ID = /^(ch|py)_[A-Za-z0-9]+$/;

async function dispatch(event: VerifiedEvent, ctx: Context): Promise<Applied> {
  if (!isHandled(event.type)) return ignored("unhandled_type");

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      if (event.subscriptionId === null) return ignored("missing_object");
      return syncSubscription(event.subscriptionId, ctx);

    case "invoice.paid":
    case "invoice.payment_failed":
      // A pass's receipt is an invoice with no subscription behind it.
      if (event.subscriptionId === null) return ignored("not_a_subscription");
      return syncSubscription(event.subscriptionId, ctx);

    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (event.objectId === null || !CHECKOUT_SESSION_ID.test(event.objectId)) return ignored("missing_object");
      return completeCheckout(event.objectId, ctx);

    case "checkout.session.async_payment_failed":
      if (event.objectId === null || !CHECKOUT_SESSION_ID.test(event.objectId)) return ignored("missing_object");
      return failCheckout(event.objectId, ctx);

    case "checkout.session.expired":
      // Nothing to read fresh: an expired session never completes. The order
      // record says so, and an expired trial checkout holds no trial.
      if (event.objectId === null || !CHECKOUT_SESSION_ID.test(event.objectId)) return ignored("missing_object");
      await markCheckout(event.objectId, "expired", ctx);
      return PROCESSED;

    case "charge.refunded":
      if (event.objectId === null || !CHARGE_ID.test(event.objectId)) return ignored("missing_object");
      return refund(event.objectId, ctx);
  }
}

/** Whatever a handler threw, as a code. Never the error's own text, which may be Stripe's. */
function appliedFrom(error: unknown): Applied {
  if (error instanceof StoreFailure) return failed(error.code);
  if (isBillingProviderError(error)) return failed(error.code);
  return failed("unexpected");
}

const codeOf = (applied: Applied): string | null => (applied.status === "processed" ? null : applied.code);

export async function applyBillingEvent(event: VerifiedEvent, deps: BillingEventDeps): Promise<BillingEventOutcome> {
  const outcome = await applyEvent(event, deps);
  if (outcome.outcome === "failed" && deps.alerts) {
    // Stripe will retry; an operator should know it is having to. Once per
    // event, under the sink's dedupe key, however many retries fail.
    await deps.alerts
      .notify({ kind: "billing.event_failed", eventId: event.id, eventType: event.type, code: outcome.code })
      .catch(() => undefined);
  }
  return outcome;
}

async function applyEvent(event: VerifiedEvent, deps: BillingEventDeps): Promise<BillingEventOutcome> {
  const log = withFields(deps.logger, { eventId: event.id, eventType: event.type });
  const ctx: Context = { ...deps, log };

  // Step 2: claim it. Nothing is applied from an event that is not recorded.
  const claim = await deps.repo
    .claimEvent({ eventId: event.id, type: event.type, createdAt: event.created })
    .catch(() => null);
  if (claim === null || !claim.ok) {
    const code = claim === null ? "store_unavailable" : `store_${claim.error.kind}`;
    log.error("billing.event_failed", { audit: true, outcome: "failed", code });
    return { outcome: "failed", httpStatus: 500, code };
  }
  if (claim.data === "processed") {
    log.info("billing.event_duplicate", { outcome: "duplicate" });
    return { outcome: "duplicate", httpStatus: 200 };
  }

  // Step 3: apply it.
  const applied = await dispatch(event, ctx).catch(appliedFrom);

  // Step 4: record how it ended. If that cannot be written the work is
  // answered as a failure: Stripe sends it again, and applying it again is
  // harmless, where acknowledging it would leave the inbox saying received.
  const finished = await deps.repo
    .finishEvent(event.id, applied.status, codeOf(applied), deps.now())
    .catch(() => null);
  if (finished === null || !finished.ok || !finished.data) {
    const code = applied.status === "failed" ? applied.code : "finish_failed";
    log.error("billing.event_failed", { audit: true, outcome: "failed", code, applied: applied.status });
    return { outcome: "failed", httpStatus: 500, code };
  }

  const redelivered = claim.data === "retry";
  switch (applied.status) {
    case "processed":
      log.info("billing.event_processed", { outcome: "processed", redelivered });
      return { outcome: "processed", httpStatus: 200 };
    case "ignored":
      log.info("billing.event_ignored", { outcome: "ignored", code: applied.code, redelivered });
      return { outcome: "ignored", httpStatus: 200, code: applied.code };
    case "failed":
      log.warn("billing.event_failed", { audit: true, outcome: "failed", code: applied.code, redelivered });
      return { outcome: "failed", httpStatus: 500, code: applied.code };
  }
}
