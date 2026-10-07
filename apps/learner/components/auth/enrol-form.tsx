"use client";

import { useActionState } from "react";

import { buttonPrimary, buttonQuiet, field, prose } from "@dp/ui/styles";

import type { EnrolmentFormState } from "@/lib/auth/mfa-state";

export interface EnrolFormProps {
  readonly action: (state: EnrolmentFormState, formData: FormData) => Promise<EnrolmentFormState>;
  readonly initialState: EnrolmentFormState;
  /** Where the learner was heading, carried through as a hidden field. */
  readonly next?: string;
}

/**
 * Two steps on one page: start (the server mints a factor and hands back what
 * the authenticator app scans), then confirm with the first code it shows.
 *
 * One action state for both, deliberately. The confirm step needs the factor
 * id the begin step minted, and it gets it as the `previous` state the action
 * is called with — which is only the latest state if the two submits share a
 * hook. A hidden `intent` field tells the server which step this is.
 */
export function EnrolForm({ action, initialState, next }: EnrolFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const destination = next ? <input type="hidden" name="next" value={next} /> : null;

  if (!state.factorId || !state.qrCode) {
    return (
      <form action={formAction} className="flex w-full flex-col gap-5">
        <input type="hidden" name="intent" value="begin" />
        {destination}
        <p className={prose}>
          You need an authenticator app on your phone — Google Authenticator, Authy, 1Password
          and the like all work. Install one, then continue.
        </p>
        <p aria-live="polite" role="status" className="text-sm text-ember">
          {state.message}
        </p>
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Preparing…" : "Set up authenticator"}
        </button>
      </form>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <input type="hidden" name="intent" value="confirm" />
      {destination}
      <p className={prose}>Scan this with your authenticator app, then enter the code it shows.</p>
      {/* Supabase hands back an SVG data URL; an img keeps it out of the DOM as markup. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not an asset to optimise */}
      <img src={state.qrCode} alt="Authenticator enrolment QR code" width={192} height={192} className="rounded-lg bg-white p-2" />
      <details className="text-sm text-copy/60">
        <summary className={buttonQuiet}>Can&apos;t scan? Enter the key by hand</summary>
        <code className="mt-2 block break-all font-mono text-xs text-copy/80">{state.secret}</code>
      </details>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="code" className="font-display text-sm font-medium text-copy/80">
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
          autoFocus
          className={field}
        />
      </div>
      <p aria-live="polite" role="status" className="text-sm text-ember">
        {state.message}
      </p>
      <button type="submit" disabled={pending} className={buttonPrimary}>
        {pending ? "Checking…" : "Finish setup"}
      </button>
    </form>
  );
}
