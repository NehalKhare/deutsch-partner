/**
 * What can go wrong talking to Stripe, as a closed set of codes.
 *
 * billing-and-plans-spec.md S13: never logged is a Stripe object, an event
 * body, an email or a card's last four — and a Stripe error message can hold
 * any of them ("No such customer: …", a decline naming the card). So nothing
 * of Stripe's text survives here. What does is a code a caller can branch on,
 * a code the webhook inbox can store (its column accepts nothing else), and
 * Stripe's request id, which identifies the call in Stripe's own logs without
 * saying anything about the learner.
 */

export const BILLING_ERROR_CODES = [
  /** Stripe did not answer, answered 5xx, or the connection broke. Retry later. */
  "stripe_unavailable",
  "stripe_rate_limited",
  /** The key is wrong, revoked or of the wrong mode. An operator's problem. */
  "stripe_authentication",
  /** A restricted key without the permission this call needs. */
  "stripe_permission",
  "stripe_not_found",
  "stripe_invalid_request",
  "stripe_idempotency",
  "stripe_card_error",
  /** Stripe answered with something this module does not recognise. */
  "stripe_invalid_response",
  /** Refused before any call: the input could never have been right. */
  "billing_invalid_input",
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

export class BillingProviderError extends Error {
  readonly code: BillingErrorCode;
  /** Stripe's id for the failed request (req_…), when there was one. */
  readonly stripeRequestId: string | null;

  constructor(code: BillingErrorCode, stripeRequestId: string | null = null) {
    // The message is the code: there is no other text to leak.
    super(code);
    this.name = "BillingProviderError";
    this.code = code;
    this.stripeRequestId = stripeRequestId;
  }

  toJSON() {
    return { code: this.code, stripeRequestId: this.stripeRequestId };
  }
}

export function isBillingProviderError(value: unknown): value is BillingProviderError {
  return value instanceof BillingProviderError;
}

interface StripeErrorLike {
  readonly type?: unknown;
  readonly statusCode?: unknown;
  readonly code?: unknown;
  readonly requestId?: unknown;
}

/**
 * Stripe's error classes, by the `type` each carries. Read by name rather
 * than by `instanceof`, so an error from a second copy of the SDK — or a
 * test's hand-made one — is classified the same way.
 */
const CODE_BY_TYPE: Readonly<Record<string, BillingErrorCode>> = {
  StripeRateLimitError: "stripe_rate_limited",
  RateLimitError: "stripe_rate_limited",
  StripeAuthenticationError: "stripe_authentication",
  StripePermissionError: "stripe_permission",
  StripeIdempotencyError: "stripe_idempotency",
  StripeCardError: "stripe_card_error",
  StripeInvalidRequestError: "stripe_invalid_request",
};

/**
 * Any failure, as a billing error. Anything unrecognised — a network error,
 * an APIError, a bug — is "unavailable": retrying is the only safe thing a
 * caller can do with a failure it cannot name.
 */
export function billingErrorFrom(error: unknown): BillingProviderError {
  if (error instanceof BillingProviderError) return error;
  if (typeof error !== "object" || error === null) return new BillingProviderError("stripe_unavailable");

  const { type, statusCode, code, requestId } = error as StripeErrorLike;
  const request = typeof requestId === "string" && /^req_[A-Za-z0-9]+$/.test(requestId) ? requestId : null;

  let mapped: BillingErrorCode = typeof type === "string" ? (CODE_BY_TYPE[type] ?? "stripe_unavailable") : "stripe_unavailable";
  if (mapped === "stripe_invalid_request" && (statusCode === 404 || code === "resource_missing")) {
    mapped = "stripe_not_found";
  }

  return new BillingProviderError(mapped, request);
}
