import { z } from "zod";

/**
 * The second factor, as both apps use it.
 *
 * Supabase Auth holds the factors; this is the narrow slice of its MFA client
 * a login flow needs, typed so a test can hand in a fake. TOTP only: a phone
 * is a channel this product does not otherwise have, and a password plus an
 * authenticator app is what "a second factor" means here, for an operator
 * and for a learner alike. Each app names its own factor (see
 * beginTotpEnrolment) so a learner who is also an operator can tell the two
 * entries in their authenticator apart.
 */
export interface MfaFactor {
  readonly id: string;
  readonly status: "verified" | "unverified";
  readonly factor_type: string;
}

export interface MfaClient {
  auth: {
    mfa: {
      listFactors(): Promise<{
        data: { totp?: MfaFactor[]; all?: MfaFactor[] } | null;
        error: { message?: string | null } | null;
      }>;
      enroll(params: { factorType: "totp"; friendlyName?: string }): Promise<{
        data: { id: string; totp: { qr_code: string; secret: string; uri: string } } | null;
        error: { message?: string | null } | null;
      }>;
      challengeAndVerify(params: { factorId: string; code: string }): Promise<{
        data: unknown | null;
        error: { message?: string | null } | null;
      }>;
      unenroll(params: { factorId: string }): Promise<{ error: unknown | null }>;
    };
  };
}

/** Six digits, as every authenticator app produces. Anything else is refused before the provider sees it. */
export const totpCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the six-digit code from your authenticator app."));

/** The verified TOTP factor to challenge, if the account has one. */
export async function verifiedTotpFactor(client: MfaClient): Promise<MfaFactor | null> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error || !data) return null;

  return (data.totp ?? []).find((factor) => factor.status === "verified") ?? null;
}

/**
 * Starts enrolment, clearing any enrolment that was abandoned half-way: an
 * unverified factor with the same name blocks a new one. The name is what the
 * authenticator app shows beside the code.
 */
export async function beginTotpEnrolment(client: MfaClient, factorName: string) {
  const { data } = await client.auth.mfa.listFactors();
  for (const factor of data?.totp ?? []) {
    if (factor.status === "unverified") await client.auth.mfa.unenroll({ factorId: factor.id });
  }

  const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: factorName });
  if (enrolled.error || !enrolled.data) return null;

  return {
    factorId: enrolled.data.id,
    qrCode: enrolled.data.totp.qr_code,
    secret: enrolled.data.totp.secret,
  };
}

/** Whether this factor id belongs to the signed-in account. Never trust the form's id alone. */
export async function ownsFactor(client: MfaClient, factorId: string): Promise<boolean> {
  const { data } = await client.auth.mfa.listFactors();
  return (data?.all ?? data?.totp ?? []).some((factor) => factor.id === factorId);
}

/** Verifies a code against a factor. True when the session is now at aal2. */
export async function verifyTotp(client: MfaClient, factorId: string, code: string): Promise<boolean> {
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
  return error === null;
}
