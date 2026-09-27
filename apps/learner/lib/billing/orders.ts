import { z } from "zod";

import { isBillingProviderError } from "@dp/billing/errors";
import { TRIAL_CHECKOUT_LIFETIME_SECONDS, type BillingProvider } from "@dp/billing/provider";
import type {
  BillingAdminRepository,
  BillingPrice,
  LearnerBillingRepository,
} from "@dp/db/billing-repository";
import type { RateLimiter } from "@dp/db/rate-limit-repository";
import {
  OFFERS,
  TERMS_VERSION,
  TRIAL_DAYS,
  offerKeySchema,
  type OfferKey,
} from "@dp/domain/billing";
import type { Logger } from "@dp/observability/logger";

import { planName } from "@/lib/billing/copy";
import type { BillingActionError } from "@/lib/billing/form-state";
import { formatMinor } from "@/lib/billing/format";
import { BILLING_PATH, TRIAL_OFFER } from "@/lib/billing/offers";
import { standingFrom } from "@/lib/billing/standing";

/**
 * Placing an order, starting the trial, and opening the Customer Portal.
 *
 * billing-and-plans-spec.md S6. The order is placed here, on this
 * application's order page, because German law needs the button that places
 * a paid order to say so and hosted Checkout's cannot (§312j BGB). So the
 * order and the early-start consent are recorded first; only then is a
 * Checkout Session opened, carrying that record's id; and a session is never
 * opened without one. Stripe's page then collects a payment method for an
 * order that already exists.
 *
 * Kept out of the Server Actions so every refusal can be tested without a
 * request: the actions read the session, call these, and redirect.
 *
 * The learner is the verified session's, handed in; nothing here takes an id
 * from a form. The only thing a form supplies besides its choices is the
 * amount the learner was shown, and that is compared, never charged: Stripe
 * charges the Price, and if the Price moved since the page was drawn the
 * order is refused rather than placed at a figure nobody saw.
 */

export { BILLING_ACTION_ERRORS, type BillingActionError } from "@/lib/billing/form-state";

export type BillingOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: BillingActionError };

export interface BillingIdentity {
  readonly learnerId: string;
  /** For the rate limiter and the audit trail. The id itself is never logged. */
  readonly userIdHash: string;
}

export interface BillingOrderDeps {
  /** Null when no Stripe key is configured: payments are off, and every door here says so. */
  readonly provider: BillingProvider | null;
  /** The learner's own rows, on their RLS client: what they have, and whether the trial is used. */
  readonly learner: Pick<LearnerBillingRepository, "grantsFor">;
  /** On the secret key: the order record, the customer mapping, the price mirror. */
  readonly admin: Pick<
    BillingAdminRepository,
    | "customerFor"
    | "saveCustomer"
    | "createCheckout"
    | "openTrialCheckout"
    | "abandonCheckout"
    | "attachCheckoutSession"
    | "activePrices"
  >;
  readonly limiter: RateLimiter;
  /** Trial starts per day; see startTrial. */
  readonly trialLimiter: RateLimiter;
  readonly logger: Logger;
  readonly now: () => Date;
  /** Where Stripe sends the learner back to. From APP_URL, never a request header. */
  readonly appUrl: string;
  readonly automaticTax: boolean;
  readonly currency: string;
}

const refuse = (error: BillingActionError): BillingOutcome => ({ ok: false, error });

/** What the order form posts. The consent is a real, unticked checkbox: present means ticked. */
const orderFormSchema = z.object({
  offer: offerKeySchema,
  consent: z.literal("on"),
  shownAmountMinor: z.coerce.number().int().min(0),
});

export interface OrderForm {
  readonly offer: unknown;
  readonly consent: unknown;
  readonly shownAmountMinor: unknown;
}

function priceOf(prices: readonly BillingPrice[], offer: OfferKey, currency: string): BillingPrice | null {
  return prices.find((row) => row.active && row.lookupKey === offer && row.currency === currency) ?? null;
}

/**
 * Beside Stripe's button, restating the order already placed and what it
 * costs, so the page that takes the payment cannot be mistaken for the one
 * that made the commitment.
 */
function submitMessageFor(offer: OfferKey, price: BillingPrice): string {
  const { plan, kind, interval } = OFFERS[offer];
  const amount = formatMinor(price.unitAmountMinor, price.currency);
  const name = `Deutsch Partner ${planName(plan)}`;

  if (kind === "pass") {
    const days = price.passDays === null ? "" : `${price.passDays} days for `;
    return (
      `You have ordered the ${name} pass: ${days}${amount}, including VAT, ` +
      `paid once. Entering a payment method here completes that order.`
    );
  }
  return (
    `You have ordered ${name} at ${amount} per ${interval}, including VAT. It renews every ` +
    `${interval} until you cancel. Entering a payment method here completes that order.`
  );
}

const TRIAL_MESSAGE =
  `Your ${TRIAL_DAYS}-day Premium trial starts now. No card is needed and nothing will be ` +
  `charged: the trial ends by itself.`;

/** The learner's Stripe customer: the one on record, or a new one saved before it is used. */
async function customerFor(learnerId: string, provider: BillingProvider, deps: BillingOrderDeps): Promise<string | null> {
  const known = await deps.admin.customerFor(learnerId);
  if (!known.ok) return null;
  if (known.data !== null) return known.data;

  const created = await provider.createCustomer({ learnerId });
  // What comes back is the stored one: if two first orders raced, both use
  // the customer that won, and the other is an empty customer in Stripe.
  const saved = await deps.admin.saveCustomer(learnerId, created.customerId);
  return saved.ok ? saved.data : null;
}

/** The order record, made: its id, or the refusal that means no session may open. */
type Recorded = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: BillingActionError };

interface Opening {
  readonly offer: OfferKey;
  readonly price: BillingPrice;
  readonly kind: "order" | "trial";
  /** Makes the order record. Called once the customer exists, before any session does. */
  readonly record: () => Promise<Recorded>;
}

/** Records the order, then opens Checkout for it. The record always comes first. */
async function open(
  opening: Opening,
  identity: BillingIdentity,
  provider: BillingProvider,
  deps: BillingOrderDeps,
): Promise<BillingOutcome> {
  const { offer, price, kind } = opening;
  const offerShape = OFFERS[offer];
  let checkoutId: string | null = null;

  try {
    const customerId = await customerFor(identity.learnerId, provider, deps);
    if (customerId === null) return refuse("unavailable");

    const checkout = await opening.record();
    if (!checkout.ok) return refuse(checkout.error);
    checkoutId = checkout.id;

    const session = await provider.createCheckoutSession({
      customerId,
      priceId: price.stripePriceId,
      mode: offerShape.kind === "pass" ? "payment" : "subscription",
      trial: kind === "trial" ? { days: TRIAL_DAYS } : null,
      successUrl: new URL(`${BILLING_PATH}/success?offer=${offer}`, deps.appUrl).toString(),
      cancelUrl: new URL(`${BILLING_PATH}?checkout=cancelled`, deps.appUrl).toString(),
      automaticTax: deps.automaticTax,
      clientReferenceId: checkout.id,
      submitMessage: kind === "trial" ? TRIAL_MESSAGE : submitMessageFor(offer, price),
    });

    // Corroboration only — the webhook finds the learner by customer — so a
    // failure here is noted and the learner still goes to pay.
    const attached = await deps.admin.attachCheckoutSession(checkout.id, session.id);
    if (!attached.ok || !attached.data) {
      deps.logger.warn("billing.checkout_unattached", { userIdHash: identity.userIdHash });
    }

    deps.logger.info("billing.checkout_started", {
      audit: true,
      userIdHash: identity.userIdHash,
      offer,
      plan: offerShape.plan,
      kind,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    // The code, never Stripe's text: its messages can name the customer.
    const code = isBillingProviderError(error) ? error.code : "unexpected";
    deps.logger.warn("billing.checkout_failed", { userIdHash: identity.userIdHash, code });
    // The record stays, marked as never having opened: a trial checkout left
    // "created" would hold the learner's one trial for nothing.
    if (checkoutId !== null) await deps.admin.abandonCheckout(checkoutId).catch(() => undefined);
    return refuse("unavailable");
  }
}

export async function placeOrder(
  form: OrderForm,
  identity: BillingIdentity,
  deps: BillingOrderDeps,
): Promise<BillingOutcome> {
  const provider = deps.provider;
  if (provider === null) return refuse("payments_off");

  const decision = await deps.limiter.check(identity.userIdHash);
  if (!decision.allowed) return refuse("rate_limited");

  const parsed = orderFormSchema.safeParse(form);
  if (!parsed.success) {
    const offerOk = offerKeySchema.safeParse(form.offer).success;
    return refuse(offerOk && form.consent !== "on" ? "consent_required" : "invalid_offer");
  }
  const { offer, shownAmountMinor } = parsed.data;

  const prices = await deps.admin.activePrices();
  if (!prices.ok) return refuse("unavailable");
  const price = priceOf(prices.data, offer, deps.currency);
  if (price === null) return refuse("price_unavailable");
  if (price.unitAmountMinor !== shownAmountMinor) return refuse("price_changed");

  // Read as the learner, under RLS. Unreadable is a refusal rather than a
  // guess: the one thing worse than no sale is a second subscription. The
  // trial is not one: it is paid for by nobody, and the order page is where
  // a learner on it orders what comes after.
  const rows = await deps.learner.grantsFor(identity.learnerId);
  if (!rows.ok) return refuse("unavailable");
  if (OFFERS[offer].kind === "subscription" && standingFrom(rows.data, deps.now()).paidSubscription !== null) {
    return refuse("already_subscribed");
  }

  const earlyStartConsentAt = deps.now();
  const record = async (): Promise<Recorded> => {
    const checkout = await deps.admin.createCheckout({
      learnerId: identity.learnerId,
      offerKey: offer,
      kind: "order",
      termsVersion: TERMS_VERSION,
      earlyStartConsentAt,
    });
    return checkout.ok ? { ok: true, id: checkout.data } : { ok: false, error: "unavailable" };
  };

  return open({ offer, price, kind: "order", record }, identity, provider, deps);
}

/**
 * Premium's one trial: no card, no order page, no consent — a trial that
 * cannot turn into a charge places no paid order (spec S6).
 *
 * One per learner, ever. The subscription rows say whether it was had; they
 * are written by the webhook once a session completes, so they cannot stop a
 * second session opening beside a first that is still on Stripe's page. The
 * order record does that: the trial checkout is recorded under a per-learner
 * lock, and refused while an earlier one could still be completed — which
 * is only as long as the session lives (TRIAL_CHECKOUT_LIFETIME_SECONDS).
 */
export async function startTrial(identity: BillingIdentity, deps: BillingOrderDeps): Promise<BillingOutcome> {
  const provider = deps.provider;
  if (provider === null) return refuse("payments_off");

  const decision = await deps.limiter.check(identity.userIdHash);
  if (!decision.allowed) return refuse("rate_limited");

  const rows = await deps.learner.grantsFor(identity.learnerId);
  if (!rows.ok) return refuse("unavailable");
  const standing = standingFrom(rows.data, deps.now());
  // Said as what is true of this account: a learner who subscribed without a
  // trial has not "had" one.
  const ineligible: BillingActionError = standing.trialUsed ? "trial_used" : "trial_not_for_subscribers";
  if (!standing.trialEligible) return refuse(ineligible);

  const daily = await deps.trialLimiter.check(identity.userIdHash);
  if (!daily.allowed) return refuse("rate_limited");

  const prices = await deps.admin.activePrices();
  if (!prices.ok) return refuse("unavailable");
  const price = priceOf(prices.data, TRIAL_OFFER, deps.currency);
  if (price === null) return refuse("price_unavailable");

  const record = async (): Promise<Recorded> => {
    const opened = await deps.admin.openTrialCheckout({
      learnerId: identity.learnerId,
      offerKey: TRIAL_OFFER,
      termsVersion: TERMS_VERSION,
      openForSeconds: TRIAL_CHECKOUT_LIFETIME_SECONDS,
    });
    if (!opened.ok) return { ok: false, error: "unavailable" };
    switch (opened.data.status) {
      case "created":
        return { ok: true, id: opened.data.id };
      case "open":
        return { ok: false, error: "trial_open" };
      case "used":
        return { ok: false, error: ineligible };
    }
  };

  return open({ offer: TRIAL_OFFER, price, kind: "trial", record }, identity, provider, deps);
}

/**
 * Stripe's Customer Portal: changing plan, the card, cancelling, invoices.
 * Only for the learner's own customer, found by their verified id.
 */
export async function openPortal(identity: BillingIdentity, deps: BillingOrderDeps): Promise<BillingOutcome> {
  const provider = deps.provider;
  if (provider === null) return refuse("payments_off");

  const decision = await deps.limiter.check(identity.userIdHash);
  if (!decision.allowed) return refuse("rate_limited");

  const customer = await deps.admin.customerFor(identity.learnerId);
  if (!customer.ok) return refuse("unavailable");
  if (customer.data === null) return refuse("no_customer");

  // Not during the trial, unless a plan was also ordered. The portal is where
  // a card is added and a plan changed; on a trial, either would turn it
  // into a charge without the order page, the consent or the order record.
  const rows = await deps.learner.grantsFor(identity.learnerId);
  if (!rows.ok) return refuse("unavailable");
  const standing = standingFrom(rows.data, deps.now());
  if (standing.trial !== null && standing.paidSubscription === null) return refuse("trial_running");

  try {
    const portal = await provider.createPortalSession({
      customerId: customer.data,
      returnUrl: new URL(BILLING_PATH, deps.appUrl).toString(),
    });
    deps.logger.info("billing.portal_opened", { audit: true, userIdHash: identity.userIdHash });
    return { ok: true, url: portal.url };
  } catch (error) {
    const code = isBillingProviderError(error) ? error.code : "unexpected";
    deps.logger.warn("billing.portal_failed", { userIdHash: identity.userIdHash, code });
    return refuse("unavailable");
  }
}
