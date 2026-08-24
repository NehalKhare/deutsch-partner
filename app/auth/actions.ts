"use server";

import { redirect } from "next/navigation";

import { signUpSchema } from "@/lib/auth/credentials";
import type { AuthFormState } from "@/lib/auth/form-state";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/errors";
import { LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { createAuthService, type AuthClient } from "@/lib/auth/service";
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

  redirect(safeNextPath(null));
}

export async function signOutAction(): Promise<never> {
  const service = await authService();
  await service.signOut();

  redirect(LOGIN_PATH);
}
