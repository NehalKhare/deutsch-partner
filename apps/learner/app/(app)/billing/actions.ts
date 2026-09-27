"use server";

import { redirect } from "next/navigation";

import { createBillingGraph, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import {
  billingFormError,
  type BillingFormState,
} from "@/lib/billing/form-state";
import { BILLING_PATH } from "@/lib/billing/offers";
import {
  openPortal,
  placeOrder,
  startTrial,
  type BillingIdentity,
  type BillingOrderDeps,
  type BillingOutcome,
} from "@/lib/billing/orders";

/**
 * The order button, the trial button and "Manage billing".
 *
 * Each reads the learner from the verified session — never from the form —
 * and hands the rest to lib/billing/orders.ts, where every refusal is decided
 * and tested. Success leaves for a page on Stripe's own domain; a refusal
 * comes back as words on the form, and a learner who already subscribes is
 * sent to Plan & billing, where a plan is changed rather than bought twice.
 */

/**
 * The learner and their pseudonym, or null when there is no pseudonym to key
 * the rate limit by. Failing is right here, where it would not be for a log
 * line: a limiter keyed on a shared placeholder would rate-limit every
 * learner as one.
 */
async function identity(): Promise<BillingIdentity | null> {
  const learnerId = await requireAuthenticatedUserId();
  try {
    return { learnerId, userIdHash: pseudonymFor(learnerId) };
  } catch {
    return null;
  }
}

async function deps(): Promise<BillingOrderDeps> {
  return {
    ...(await createBillingGraph()),
    limiter: limiterFor("billing"),
    trialLimiter: limiterFor("billing_trial"),
  };
}

function settle(result: BillingOutcome): BillingFormState {
  if (result.ok) redirect(result.url);
  if (result.error === "already_subscribed") redirect(BILLING_PATH);
  return billingFormError(result.error);
}

/** The order page's button: "Order with obligation to pay". */
export async function placeOrderAction(
  _previous: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const who = await identity();
  if (!who) return billingFormError("unavailable");

  return settle(
    await placeOrder(
      {
        offer: formData.get("offer"),
        consent: formData.get("consent"),
        shownAmountMinor: formData.get("shownAmountMinor"),
      },
      who,
      await deps(),
    ),
  );
}

/** Premium's one trial, with no card. */
export async function startTrialAction(
  _previous: BillingFormState,
  _formData: FormData,
): Promise<BillingFormState> {
  const who = await identity();
  if (!who) return billingFormError("unavailable");

  return settle(await startTrial(who, await deps()));
}

/** Stripe's Customer Portal, for the learner's own customer. */
export async function openPortalAction(
  _previous: BillingFormState,
  _formData: FormData,
): Promise<BillingFormState> {
  const who = await identity();
  if (!who) return billingFormError("unavailable");

  return settle(await openPortal(who, await deps()));
}
