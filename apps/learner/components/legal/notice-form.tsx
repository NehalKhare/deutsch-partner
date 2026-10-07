"use client";

import { useActionState } from "react";

import { PendingButton } from "@dp/ui/pending-button";
import { buttonPrimary, choice, control, field } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { INITIAL_NOTICE_STATE, type NoticeFormState } from "@/lib/legal/notices";

const label = "font-display text-sm font-medium text-copy/80";

/**
 * The cancellation form and the withdrawal form: an address, what the
 * notice is about, an optional line to identify it, and the one button.
 *
 * Nothing else on purpose. §312k(2) BGB says the confirmation page may hold
 * only what the consumer needs to say and the button; a "before you go"
 * offer here is what the BGH struck down (I ZR 200/25).
 */
export function NoticeForm({
  action,
  submitLabel,
  email,
  contractLabels,
}: {
  readonly action: (state: NoticeFormState, formData: FormData) => Promise<NoticeFormState>;
  /** "Cancel now" or "Withdraw now": the statutory second step. */
  readonly submitLabel: string;
  /** Pre-filled from the session where there is one. Still editable: the account address may not be theirs any more. */
  readonly email?: string;
  readonly contractLabels: {
    readonly subscription: string;
    readonly pass: string;
    readonly unknown: string;
  };
}) {
  const [state, formAction] = useActionState(action, INITIAL_NOTICE_STATE);

  if (state.status === "done" && state.receipt) {
    return <NoticeReceiptView receipt={state.receipt} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="notice-email" className={label}>
          Email address of your account
        </label>
        <input
          id="notice-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={email}
          className={field}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={cn(label, "mb-1.5")}>What this is about</legend>
        {(["subscription", "pass", "unknown"] as const).map((value, index) => (
          <label key={value} className={cn(choice, "items-center p-2.5 text-sm")}>
            <input
              type="radio"
              name="contract"
              value={value}
              defaultChecked={index === 0}
              className={control}
            />
            <span>{contractLabels[value]}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notice-detail" className={label}>
          Anything that helps us find it <span className="font-normal text-copy/50">(optional)</span>
        </label>
        <textarea id="notice-detail" name="detail" rows={2} maxLength={500} className={field} />
      </div>

      <p aria-live="polite" role="status" className="text-sm text-ember empty:sr-only">
        {state.message}
      </p>

      <PendingButton className={cn(buttonPrimary, "self-start")}>{submitLabel}</PendingButton>
    </form>
  );
}

const CONTRACT_WORDS = { subscription: "subscription", pass: "pass", unknown: "contract" } as const;

/**
 * The confirmation (§312k(4) BGB: immediately, in text form). Without an
 * email sender this page is the text form: reference, time, address, and a
 * word to keep it. Everything a dispute would need to establish is on it.
 */
export function NoticeReceiptView({
  receipt,
}: {
  readonly receipt: NonNullable<NoticeFormState["receipt"]>;
}) {
  const verb = receipt.kind === "cancellation" ? "cancellation" : "withdrawal";
  const when = new Date(receipt.receivedAt);
  return (
    <section
      role="status"
      aria-labelledby="receipt-heading"
      className="flex flex-col gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-5 text-sm leading-relaxed"
    >
      <h2 id="receipt-heading" className="font-display text-lg font-semibold tracking-tight">
        Your {verb} has been received
      </h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-copy/60">Reference</dt>
        <dd className="font-mono font-semibold tracking-wider">{receipt.reference}</dd>
        <dt className="text-copy/60">Received</dt>
        <dd>
          <time dateTime={receipt.receivedAt}>{when.toUTCString()}</time>
        </dd>
        <dt className="text-copy/60">For</dt>
        <dd>{receipt.email}</dd>
        <dt className="text-copy/60">About</dt>
        <dd>your {CONTRACT_WORDS[receipt.contract]}</dd>
      </dl>
      <p>
        {receipt.kind === "cancellation"
          ? "Your plan runs to the end of the period you have paid for and is not charged again."
          : "We will refund what is owed within 14 days, less the days the plan was used at your request."}
      </p>
      <p className="text-copy/75">
        {receipt.emailed
          ? "A confirmation with these details has been sent to the address above."
          : "Please save or print this page: it is your confirmation. Quote the reference if you write to us."}
      </p>
    </section>
  );
}
