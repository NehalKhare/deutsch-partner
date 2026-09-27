"use server";

import { redirect } from "next/navigation";

import { signUpSchema } from "@dp/auth/credentials";
import type { AuthFormState } from "@dp/auth/form-state";
import { AUTH_ERROR_MESSAGES } from "@dp/auth/errors";
import { DEFAULT_SIGNED_IN_PATH, LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { createAuthService, type AuthClient } from "@dp/auth/service";
import { ONBOARDING_PATH } from "@/lib/onboarding/gate";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

async function authService() {
  return createAuthService((await createServerSupabaseClient()) as AuthClient);
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const service = await authService();

  const result = await service.signIn({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }

  // Validated: a `next` value is only ever a same-site path.
  redirect(safeNextPath(formData.get("next")?.toString()));
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? AUTH_ERROR_MESSAGES.invalid_input,
    };
  }

  const service = await authService();
  const result = await service.signUp(parsed.data);

  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }

  if (result.data.needsEmailConfirmation) {
    return {
      status: "check_email",
      message: "Check your inbox for a link to confirm your email address.",
    };
  }

  // A new account is set up before it reaches any room, so a destination —
  // the plan chosen on the pricing page, say — is carried through
  // onboarding rather than dropped at its door. Validated: a same-site path.
  const next = safeNextPath(formData.get("next")?.toString());
  redirect(
    next === DEFAULT_SIGNED_IN_PATH
      ? DEFAULT_SIGNED_IN_PATH
      : `${ONBOARDING_PATH}?next=${encodeURIComponent(next)}`,
  );
}

export async function signOutAction(): Promise<never> {
  const service = await authService();
  await service.signOut();

  redirect(LOGIN_PATH);
}
