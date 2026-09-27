/**
 * What a billing form shows after its action ran, and the messages it can show.
 *
 * Shared by the Server Actions and the forms that call them, and kept out of
 * the action module because "use server" files may export only async
 * functions. Plain data with no imports, so the forms in the browser bundle
 * carry the words and nothing of the billing package.
 *
 * Every refusal says that nothing was charged where that is the worry, and
 * none of them passes on a word of Stripe's.
 */

export const BILLING_ACTION_ERRORS = {
  payments_off: "Payments are not switched on yet. Nothing was charged.",
  rate_limited: "That was a lot of attempts in a short time. Please wait a minute and try again.",
  invalid_offer: "That is not a plan we sell. Please choose one on the pricing page.",
  consent_required: "Please tick the box to ask for your plan to start straight away.",
  price_unavailable: "This price is not available just now. Nothing was charged.",
  price_changed: "The price changed after this page loaded. Please check the new price and order again.",
  already_subscribed: "You already have a subscription. Change it on Plan & billing.",
  trial_used: "The free trial has already been used on this account.",
  trial_not_for_subscribers: "The free trial is for accounts that have not subscribed before.",
  trial_open: "Your trial is already waiting on Stripe's page. Finish it there, or start again in about half an hour.",
  trial_running:
    "There is nothing to manage during the trial: it needs no card and ends by itself. To keep a plan, order it on the pricing page.",
  no_customer: "There is nothing to manage yet, because nothing has been bought.",
  unavailable: "We could not reach the payment service just now. Nothing was charged. Please try again.",
} as const;

export type BillingActionError = keyof typeof BILLING_ACTION_ERRORS;

export interface BillingFormState {
  readonly status: "idle" | "error";
  readonly message: string | null;
}

export const INITIAL_BILLING_STATE: BillingFormState = { status: "idle", message: null };

export function billingFormError(error: BillingActionError): BillingFormState {
  return { status: "error", message: BILLING_ACTION_ERRORS[error] };
}
