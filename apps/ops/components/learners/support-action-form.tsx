"use client";

import { useActionState } from "react";

import { buttonQuiet } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { SUPPORT_FORM_IDLE, type SupportFormState } from "@/lib/learner-directory";

/**
 * One correction to one learner, as a form that says how it went.
 *
 * Every support action returns a state rather than failing silently: an
 * operator who changed a learner's level on a support call needs to know it
 * took. The learner id rides along as a hidden field, and the action checks
 * it again — the form is a convenience, never the authority.
 *
 * The fields are passed in as children, so the page keeps its own markup and
 * this stays the only client code on it besides the deletion form.
 */
export function SupportActionForm({
  action,
  learnerId,
  label,
  pendingLabel = "Saving…",
  danger = false,
  className,
  children,
}: {
  readonly action: (state: SupportFormState, formData: FormData) => Promise<SupportFormState>;
  readonly learnerId: string;
  readonly label: string;
  readonly pendingLabel?: string;
  readonly danger?: boolean;
  readonly className?: string;
  readonly children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, SUPPORT_FORM_IDLE);

  return (
    <form action={formAction} className={cn("flex flex-wrap items-center gap-2", className)}>
      <input type="hidden" name="learnerId" value={learnerId} />
      {children}
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonQuiet, "px-3.5 py-1.5", danger && "border-ember/60 text-ember hover:border-ember hover:text-ember")}
      >
        {pending ? pendingLabel : label}
      </button>
      {state.message === "" ? null : (
        <span
          role="status"
          aria-live="polite"
          className={cn("text-xs", state.status === "error" ? "text-ember" : "text-copy/60")}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
