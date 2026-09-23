"use client";

import { useActionState } from "react";

import { buttonQuiet, field } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { SUPPORT_FORM_IDLE, type SupportFormState } from "@/lib/learner-directory";

/**
 * One box for the three ways a learner arrives at support: the pseudonym from
 * the ledger or the budgets page, the account id from a log, or the exact
 * email they wrote in from. A match goes straight to the learner; nothing is
 * listed, so an email is never on screen.
 */
export function FindLearnerForm({
  action,
}: {
  readonly action: (state: SupportFormState, formData: FormData) => Promise<SupportFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, SUPPORT_FORM_IDLE);

  return (
    <form action={formAction} role="search" className="flex flex-col gap-1.5">
      <label htmlFor="find-learner" className="font-display text-xs font-medium text-copy/70">
        Find a learner
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="find-learner"
          name="query"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Pseudonym, account id or exact email"
          className={cn(field, "min-w-0 flex-1 font-mono text-sm")}
        />
        <button type="submit" disabled={pending} className={buttonQuiet}>
          {pending ? "Looking…" : "Find"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-ember">
        {state.status === "error" ? state.message : ""}
      </p>
    </form>
  );
}
