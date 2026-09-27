"use client";

import { useActionState } from "react";

import { PendingButton } from "@dp/ui/pending-button";
import { buttonPrimary, choice, control } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { INITIAL_BILLING_STATE, type BillingFormState } from "@/lib/billing/form-state";

/**
 * A form that starts something with Stripe: an order, the trial, the
 * Customer Portal.
 *
 * The action redirects to Stripe on success, so the only state this ever
 * shows is a refusal, announced where a screen reader hears it. The button
 * is a PendingButton, because a second press into an order is a second
 * Checkout Session, and its words never change while pending: on the order
 * page they are the legally required ones, and "Loading…" is not.
 *
 * Whatever the server rendered for the form — hidden fields, the consent box
 * — comes in as children, so the words stay in server code.
 */

export interface BillingActionFormProps {
  readonly action: (state: BillingFormState, formData: FormData) => Promise<BillingFormState>;
  readonly submitLabel: string;
  readonly submitClassName?: string;
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function BillingActionForm({
  action,
  submitLabel,
  submitClassName = buttonPrimary,
  className,
  children,
}: BillingActionFormProps) {
  const [state, formAction] = useActionState(action, INITIAL_BILLING_STATE);

  return (
    <form action={formAction} className={cn("flex flex-col gap-4", className)}>
      {children}
      <p aria-live="polite" role="status" className="text-sm text-ember empty:sr-only">
        {state.message}
      </p>
      <PendingButton className={cn(submitClassName, "self-start")}>{submitLabel}</PendingButton>
    </form>
  );
}

/**
 * The early-start request: a real checkbox, never ticked for the learner,
 * and required, so the browser will not send an order without it — and the
 * server refuses one anyway.
 */
export function ConsentCheckbox({ label }: { label: string }) {
  return (
    <label className={cn(choice, "items-start text-sm leading-relaxed text-copy/85")}>
      <input type="checkbox" name="consent" value="on" required className={cn(control, "mt-1")} />
      <span>{label}</span>
    </label>
  );
}
