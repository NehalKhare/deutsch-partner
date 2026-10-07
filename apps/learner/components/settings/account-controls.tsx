"use client";

import { useActionState } from "react";

import { buttonQuiet, field, linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { DELETION_PHRASE } from "@/lib/account/deletion";
import type { SettingsFormState } from "@/lib/settings/input";

const label = "font-display text-sm font-medium text-copy/80";

/** Where the export is served. The link is a plain download: no JavaScript, no state. */
export const EXPORT_PATH = "/api/account/export";

/**
 * Your data: take it with you, or take it away (GDPR Art. 15, 17, 20).
 *
 * The export is a link to a file. Deletion asks for a typed phrase — a pause,
 * not a proof; the session is the proof — and says what happens before the
 * button is pressed: subscriptions end at the paid period, and everything
 * learned about them goes with the account.
 */
export function AccountControls({
  action,
  initialState,
}: {
  readonly action: (state: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;
  readonly initialState: SettingsFormState;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="flex flex-col gap-4" data-role="account-controls">
      <p className="text-sm leading-relaxed text-copy/70">
        <a href={EXPORT_PATH} download className={linkInline}>
          Export my data
        </a>{" "}
        downloads everything we hold about you as a JSON file: your profile, your progress, your
        mistakes, your orders.
      </p>

      <form action={formAction} className="flex flex-col gap-2.5">
        <p className="text-sm leading-relaxed text-copy/70">
          Deleting your account removes your profile and everything learned about you, and ends any
          subscription at the end of the period you have paid for. It cannot be undone.
        </p>
        <label htmlFor="delete-confirm" className={label}>
          Type <span className="font-mono">{DELETION_PHRASE}</span> to confirm
        </label>
        <input
          id="delete-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          required
          className={cn(field, "max-w-xs")}
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className={cn(buttonQuiet, "border-ember/60 px-3.5 py-1.5 text-xs text-ember hover:border-ember")}
          >
            {pending ? "Deleting…" : "Delete my account"}
          </button>
          {state.message ? (
            <p role="status" className={cn("text-xs", state.status === "error" ? "text-ember" : "text-copy/60")}>
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
