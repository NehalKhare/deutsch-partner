"use server";

import { createHash } from "node:crypto";

import { redirect } from "next/navigation";

import { signUpSchema } from "@dp/auth/credentials";
import type { AuthFormState } from "@dp/auth/form-state";
import { AUTH_ERROR_MESSAGES } from "@dp/auth/errors";
import { verifiedTotpFactor, type MfaClient } from "@dp/auth/mfa";
import { limiterFor } from "@/lib/api/rate-limit";
import { TOO_MANY_ATTEMPTS } from "@/lib/auth/mfa-state";
import {
  DEFAULT_SIGNED_IN_PATH,
  LOGIN_PATH,
  enrolRedirectTarget,
  safeNextPath,
  stepUpRedirectTarget,
} from "@/lib/auth/routes";
import { createAuthService, type AuthClient } from "@dp/auth/service";
import { ONBOARDING_PATH } from "@/lib/onboarding/gate";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

async function authService() {
  return createAuthService((await createServerSupabaseClient()) as AuthClient);
}

/** A rate-limit key for an address before there is an account to hash. */
function addressKey(email: unknown): string {
  return createHash("sha256")
    .update(String(email ?? "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

/**
 * Signing in is two steps: the password here, then either enrolling an
 * authenticator (first visit) or answering it (every visit after) on the
 * step-up pages. A session with only a password opens nothing else, so the
 * destination the learner was carrying — a plan chosen on the pricing page —
 * is handed on rather than reached.
 */
export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = formData.get("email");
  const allowed = await limiterFor("login").check(addressKey(email));
  if (!allowed.allowed) return { status: "error", message: TOO_MANY_ATTEMPTS };

  const supabase = await createServerSupabaseClient();
  const service = createAuthService(supabase as AuthClient);

  const result = await service.signIn({ email, password: formData.get("password") });

  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }

  // Validated: a `next` value is only ever a same-site path.
  const next = safeNextPath(formData.get("next")?.toString());
  const factor = await verifiedTotpFactor(supabase as unknown as MfaClient);
  redirect(factor ? stepUpRedirectTarget(next) : enrolRedirectTarget(next));
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
  const afterEnrolment =
    next === DEFAULT_SIGNED_IN_PATH
      ? DEFAULT_SIGNED_IN_PATH
      : `${ONBOARDING_PATH}?next=${encodeURIComponent(next)}`;

  // And before any of that, an authenticator: the session a sign-up returns
  // has only a password, which opens nothing but the enrolment page.
  redirect(enrolRedirectTarget(afterEnrolment));
}

export async function signOutAction(): Promise<never> {
  const service = await authService();
  await service.signOut();

  redirect(LOGIN_PATH);
}
