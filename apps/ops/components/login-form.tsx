"use client";

import { useActionState } from "react";

import { MIN_PASSWORD_LENGTH } from "@dp/auth/credentials";
import { buttonPrimary, field } from "@dp/ui/styles";

import type { LoginFormState } from "@/lib/auth/login-state";

const label = "font-display text-sm font-medium text-chalk/80";

export interface LoginFormProps {
  readonly action: (state: LoginFormState, formData: FormData) => Promise<LoginFormState>;
  readonly initialState: LoginFormState;
}

/** Email and password. No sign-up link: operator accounts are not self-served. */
export function LoginForm({ action, initialState }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={label}>
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={field} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={label}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className={field}
        />
      </div>

      <p aria-live="polite" role="status" className="text-sm text-ember">
        {state.message}
      </p>

      <button type="submit" disabled={pending} className={buttonPrimary}>
        {pending ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}
