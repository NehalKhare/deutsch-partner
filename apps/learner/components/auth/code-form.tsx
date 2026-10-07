"use client";

import { useActionState } from "react";

import { buttonPrimary, field } from "@dp/ui/styles";

import type { CodeFormState } from "@/lib/auth/mfa-state";

export interface CodeFormProps {
  readonly action: (state: CodeFormState, formData: FormData) => Promise<CodeFormState>;
  readonly initialState: CodeFormState;
  /** Where the learner was heading, carried through as a hidden field. */
  readonly next?: string;
}

/** The six digits from the authenticator app. */
export function CodeForm({ action, initialState, next }: CodeFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
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

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <p aria-live="polite" role="status" className="text-sm text-ember">
        {state.message}
      </p>

      <button type="submit" disabled={pending} className={buttonPrimary}>
        {pending ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}
