"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  buttonPrimary,
  field,
  linkInline,
} from "@dp/ui/styles";
import type { AuthFormState } from "@dp/auth/form-state";
import { MIN_PASSWORD_LENGTH } from "@dp/auth/credentials";
import { DEFAULT_SIGNED_IN_PATH, LOGIN_PATH, SIGN_UP_PATH } from "@/lib/auth/routes";

const label = "font-display text-sm font-medium text-copy/80";

export interface CredentialsFormProps {
  readonly mode: "sign-in" | "sign-up";
  readonly action: (
    state: AuthFormState,
    formData: FormData,
  ) => Promise<AuthFormState>;
  readonly initialState: AuthFormState;
  readonly next?: string;
}

/**
 * The other way in, keeping the destination: a visitor who chose a plan and
 * then remembered they already had an account should not lose the plan by
 * pressing "Sign in". The default destination is left off, as noise.
 */
function otherWayIn(isSignUp: boolean, next: string | undefined): string {
  const path = isSignUp ? LOGIN_PATH : SIGN_UP_PATH;
  return next && next !== DEFAULT_SIGNED_IN_PATH ? `${path}?next=${encodeURIComponent(next)}` : path;
}

export function CredentialsForm({
  mode,
  action,
  initialState,
  next,
}: CredentialsFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const isSignUp = mode === "sign-up";

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={label}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={field}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={label}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby={isSignUp ? "password-hint" : undefined}
          className={field}
        />
        {isSignUp ? (
          <p id="password-hint" className="text-xs text-copy/45">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        ) : null}
      </div>

      {isSignUp ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className={label}>
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            className={field}
          />
        </div>
      ) : null}

      {next ? <input type="hidden" name="next" value={next} /> : null}

      {/* Announced to assistive technology when it changes, not only on load. */}
      <p
        aria-live="polite"
        role="status"
        className={
          state.status === "error"
            ? "text-sm text-ember"
            : "text-sm text-sprout"
        }
      >
        {state.message}
      </p>

      <button
        type="submit"
        disabled={pending}
        className={buttonPrimary}
      >
        {pending
          ? isSignUp
            ? "Creating account…"
            : "Signing in…"
          : isSignUp
            ? "Create account"
            : "Sign in"}
      </button>

      <p className="text-sm text-copy/60">
        {isSignUp ? "Already have an account? " : "New here? "}
        <Link href={otherWayIn(isSignUp, next)} className={linkInline}>
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
