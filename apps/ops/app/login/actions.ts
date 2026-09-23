"use server";

import { createHash } from "node:crypto";

import { redirect } from "next/navigation";

import { credentialsSchema } from "@dp/auth/credentials";
import { createAuthService, type AuthClient } from "@dp/auth/service";
import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { getOperatorSession } from "@/lib/auth/current-user";
import {
  CODE_FAILURE,
  GENERIC_SIGN_IN_FAILURE,
  TOO_MANY_ATTEMPTS,
  type EnrolmentFormState,
  type LoginFormState,
} from "@/lib/auth/login-state";
import {
  beginTotpEnrolment,
  ownsFactor,
  totpCodeSchema,
  verifiedTotpFactor,
  verifyTotp,
  type MfaClient,
} from "@/lib/auth/mfa";
import { isOperator } from "@/lib/auth/operator";
import { ENROL_PATH, HOME_PATH, LOGIN_PATH, MFA_PATH } from "@/lib/auth/routes";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

/**
 * Signing in to the operator app.
 *
 * Three steps, each its own action: the password, then either enrolling an
 * authenticator (first visit) or answering it (every visit after). A session
 * with only a password is worth nothing here — the proxy sends it to the
 * second step and every page refuses it — so an operator is never half in.
 *
 * Every failure reads the same to the person typing. A learner who is not on
 * the allowlist and types their real password is signed out of this origin
 * and told exactly what a wrong password would have said: a distinguishable
 * refusal is a way to enumerate who is an operator.
 */

/** A rate-limit key for an address before there is an account to hash. */
function addressKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export async function signInAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_SIGN_IN_FAILURE };

  const allowed = await limiterFor("ops_login").check(addressKey(parsed.data.email));
  if (!allowed.allowed) return { status: "error", message: TOO_MANY_ATTEMPTS };

  const supabase = await createServerSupabaseClient();
  const service = createAuthService(supabase as unknown as AuthClient);
  const signedIn = await service.signIn(parsed.data);
  if (!signedIn.ok) return { status: "error", message: GENERIC_SIGN_IN_FAILURE };

  const logger = actionLogger();
  const userId = signedIn.data.userId;

  // The allowlist first, before any factor is looked at: a learner's account
  // gets a session for one request and then loses it again on this origin.
  if (!isOperator(userId)) {
    await supabase.auth.signOut({ scope: "local" });
    logger.warn("ops.login_denied", { audit: true, userIdHash: pseudonymOrUnavailable(userId) });
    return { status: "error", message: GENERIC_SIGN_IN_FAILURE };
  }

  logger.info("ops.login_password_ok", { audit: true, userIdHash: pseudonymOrUnavailable(userId) });

  const factor = await verifiedTotpFactor(supabase as unknown as MfaClient);
  redirect(factor ? MFA_PATH : ENROL_PATH);
}

export async function verifyMfaAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const session = await getOperatorSession();
  if (!session) redirect(LOGIN_PATH);
  if (!isOperator(session.sub)) redirect(LOGIN_PATH);

  const allowed = await limiterFor("ops_mfa").check(session.sub);
  if (!allowed.allowed) return { status: "error", message: TOO_MANY_ATTEMPTS };

  const code = totpCodeSchema.safeParse(formData.get("code"));
  if (!code.success) return { status: "error", message: CODE_FAILURE };

  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  // The factor is chosen here, never taken from the form.
  const factor = await verifiedTotpFactor(supabase);
  if (!factor) redirect(ENROL_PATH);

  const logger = actionLogger();
  const hash = pseudonymOrUnavailable(session.sub);

  if (!(await verifyTotp(supabase, factor.id, code.data))) {
    logger.warn("ops.mfa_failed", { audit: true, userIdHash: hash });
    return { status: "error", message: CODE_FAILURE };
  }

  logger.info("ops.mfa_verified", { audit: true, userIdHash: hash });
  redirect(HOME_PATH);
}

export async function beginEnrolmentAction(
  previous: EnrolmentFormState,
): Promise<EnrolmentFormState> {
  const session = await getOperatorSession();
  if (!session || !isOperator(session.sub)) redirect(LOGIN_PATH);

  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  // An operator with a verified factor answers it; they do not enrol another.
  if (await verifiedTotpFactor(supabase)) redirect(MFA_PATH);

  const begun = await beginTotpEnrolment(supabase);
  if (!begun) {
    return { ...previous, status: "error", message: "Could not start enrolment. Try again." };
  }

  return { status: "enrolling", message: null, ...begun };
}

export async function confirmEnrolmentAction(
  previous: EnrolmentFormState,
  formData: FormData,
): Promise<EnrolmentFormState> {
  const session = await getOperatorSession();
  if (!session || !isOperator(session.sub)) redirect(LOGIN_PATH);

  const allowed = await limiterFor("ops_mfa").check(session.sub);
  if (!allowed.allowed) return { ...previous, status: "error", message: TOO_MANY_ATTEMPTS };

  const code = totpCodeSchema.safeParse(formData.get("code"));
  const factorId = previous.factorId;
  if (!code.success || !factorId) return { ...previous, status: "error", message: CODE_FAILURE };

  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  // The id came back through the form's state; make sure it is this account's.
  if (!(await ownsFactor(supabase, factorId))) redirect(ENROL_PATH);

  const logger = actionLogger();
  const hash = pseudonymOrUnavailable(session.sub);

  if (!(await verifyTotp(supabase, factorId, code.data))) {
    logger.warn("ops.mfa_failed", { audit: true, userIdHash: hash, enrolling: true });
    return { ...previous, status: "error", message: CODE_FAILURE };
  }

  logger.info("ops.mfa_enrolled", { audit: true, userIdHash: hash });
  redirect(HOME_PATH);
}

export async function signOutAction(): Promise<never> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });

  redirect(LOGIN_PATH);
}
