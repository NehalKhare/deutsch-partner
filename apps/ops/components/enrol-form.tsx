"use client";

import { useActionState } from "react";

import { buttonPrimary, buttonQuiet, field, prose } from "@dp/ui/styles";

import type { EnrolmentFormState } from "@/lib/auth/login-state";

export interface EnrolFormProps {
  readonly begin: (state: EnrolmentFormState) => Promise<EnrolmentFormState>;
  readonly confirm: (state: EnrolmentFormState, formData: FormData) => Promise<EnrolmentFormState>;
  readonly initialState: EnrolmentFormState;
}

/**
 * Two steps on one page: start (the server mints a factor and hands back what
 * the authenticator app scans), then confirm with the first code it shows.
 */
export function EnrolForm({ begin, confirm, initialState }: EnrolFormProps) {
  const [state, beginAction, beginning] = useActionState(begin, initialState);
  const [confirmed, confirmAction, confirming] = useActionState(confirm, state);
  const current = confirmed.factorId ? confirmed : state;

  if (!current.factorId || !current.qrCode) {
    return (
      <form action={beginAction} className="flex w-full flex-col gap-5">
        <p className={prose}>
          Your account needs an authenticator app before it can open the operations pages.
          Install one on your phone, then continue.
        </p>
        <p aria-live="polite" role="status" className="text-sm text-ember">
          {current.message}
        </p>
        <button type="submit" disabled={beginning} className={buttonPrimary}>
          {beginning ? "Preparing…" : "Set up authenticator"}
        </button>
      </form>
    );
  }

  return (
    <form action={confirmAction} className="flex w-full flex-col gap-5">
      <p className={prose}>Scan this with your authenticator app, then enter the code it shows.</p>
      {/* Supabase hands back an SVG data URL; an img keeps it out of the DOM as markup. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not an asset to optimise */}
      <img src={current.qrCode} alt="Authenticator enrolment QR code" width={192} height={192} className="rounded-lg bg-chalk p-2" />
      <details className="text-sm text-chalk/60">
        <summary className={buttonQuiet}>Can&apos;t scan? Enter the key by hand</summary>
        <code className="mt-2 block break-all font-mono text-xs text-chalk/80">{current.secret}</code>
      </details>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="code" className="font-display text-sm font-medium text-chalk/80">
          Code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          required
          className={field}
        />
      </div>
      <p aria-live="polite" role="status" className="text-sm text-ember">
        {current.message}
      </p>
      <button type="submit" disabled={confirming} className={buttonPrimary}>
        {confirming ? "Checking…" : "Finish setup"}
      </button>
    </form>
  );
}
