"use server";

import { redirect } from "next/navigation";

import {
  beginTotpEnrolment,
  ownsFactor,
  totpCodeSchema,
  verifiedTotpFactor,
  verifyTotp,
  type MfaClient,
} from "@dp/auth/mfa";

import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import {
  CODE_FAILURE,
  ENROLMENT_FAILURE,
  FACTOR_NAME,
  TOO_MANY_ATTEMPTS,
  type CodeFormState,
  type EnrolmentFormState,
} from "@/lib/auth/mfa-state";
import { enrolRedirectTarget, safeNextPath, stepUpRedirectTarget } from "@/lib/auth/routes";
import { requireStepUpSession } from "@/lib/auth/step-up";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

/**
 * The second step of signing in: answering an authenticator, or setting one
 * up on the first visit.
 *
 * A session with only a password is worth nothing in this app — the proxy
 * sends it here and every page refuses it — so a learner is never half in.
 * The destination they were carrying rides along as `next`, validated as a
 * same-site path on the way in and again on the way out.
 */

export async function verifyMfaAction(
  _previous: CodeFormState,
  formData: FormData,
): Promise<CodeFormState> {
  const next = formData.get("next")?.toString();
  const session = await requireStepUpSession(next);

  const allowed = await limiterFor("mfa").check(session.sub);
  if (!allowed.allowed) return { status: "error", message: TOO_MANY_ATTEMPTS };

  const code = totpCodeSchema.safeParse(formData.get("code"));
  if (!code.success) return { status: "error", message: CODE_FAILURE };

  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  // The factor is chosen here, never taken from the form.
  const factor = await verifiedTotpFactor(supabase);
  if (!factor) redirect(enrolRedirectTarget(next ?? "/"));

  const logger = actionLogger();
  const hash = pseudonymOrUnavailable(session.sub);

  if (!(await verifyTotp(supabase, factor.id, code.data))) {
    logger.warn("auth.mfa_failed", { audit: true, userIdHash: hash });
    return { status: "error", message: CODE_FAILURE };
  }

  logger.info("auth.mfa_verified", { audit: true, userIdHash: hash });
  redirect(safeNextPath(next));
}

/**
 * Enrolment is one action with two intents, so that the form can keep one
 * action state across both submits and the confirm step is handed the factor
 * the begin step minted. A confirm with nothing minted yet is treated as a
 * begin: there is nothing to check a code against.
 */
export async function enrolmentAction(
  previous: EnrolmentFormState,
  formData: FormData,
): Promise<EnrolmentFormState> {
  if (formData.get("intent") === "confirm" && previous.factorId) {
    return confirmEnrolment(previous, formData);
  }
  return beginEnrolment(previous, formData);
}

async function beginEnrolment(
  previous: EnrolmentFormState,
  formData: FormData,
): Promise<EnrolmentFormState> {
  const next = formData.get("next")?.toString();
  await requireStepUpSession(next);

  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  // A learner with a verified factor answers it; they do not enrol another.
  if (await verifiedTotpFactor(supabase)) redirect(stepUpRedirectTarget(next ?? "/"));

  const begun = await beginTotpEnrolment(supabase, FACTOR_NAME);
  if (!begun) return { ...previous, status: "error", message: ENROLMENT_FAILURE };

  return { status: "enrolling", message: null, ...begun };
}

async function confirmEnrolment(
  previous: EnrolmentFormState,
  formData: FormData,
): Promise<EnrolmentFormState> {
  const next = formData.get("next")?.toString();
  const session = await requireStepUpSession(next);

  const allowed = await limiterFor("mfa").check(session.sub);
  if (!allowed.allowed) return { ...previous, status: "error", message: TOO_MANY_ATTEMPTS };

  const code = totpCodeSchema.safeParse(formData.get("code"));
  const factorId = previous.factorId;
  if (!code.success || !factorId) return { ...previous, status: "error", message: CODE_FAILURE };

  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  // The id came back through the form's state; make sure it is this account's.
  if (!(await ownsFactor(supabase, factorId))) redirect(enrolRedirectTarget(next ?? "/"));

  const logger = actionLogger();
  const hash = pseudonymOrUnavailable(session.sub);

  if (!(await verifyTotp(supabase, factorId, code.data))) {
    logger.warn("auth.mfa_failed", { audit: true, userIdHash: hash, enrolling: true });
    return { ...previous, status: "error", message: CODE_FAILURE };
  }

  logger.info("auth.mfa_enrolled", { audit: true, userIdHash: hash });
  redirect(safeNextPath(next));
}
