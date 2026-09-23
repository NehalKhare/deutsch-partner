import { z } from "zod";

/**
 * What a verified token says about who is asking.
 *
 * Read through getClaims, which verifies the JWT against the project's signing
 * keys, never from a request body. The assurance level is the claim the
 * operator app steps up on: 'aal1' is a password, 'aal2' is a password and a
 * second factor. A token without the claim is at aal1, per Supabase.
 */
export const ASSURANCE_LEVELS = ["aal1", "aal2"] as const;
export const assuranceLevelSchema = z.enum(ASSURANCE_LEVELS);
export type AssuranceLevel = z.infer<typeof assuranceLevelSchema>;

const subjectSchema = z.uuid();
/** The address is shown back to its owner, so a malformed one is simply absent. */
const emailSchema = z.email().max(320);

export interface SessionClaims {
  readonly sub: string;
  readonly email: string | null;
  readonly aal: AssuranceLevel;
}

export interface ClaimsClient {
  auth: {
    getClaims(): Promise<{
      data: { claims?: Record<string, unknown> } | null;
      error: unknown | null;
    }>;
  };
}

/** The session's claims, or null when there is no valid session. Never throws. */
export async function readSessionClaims(client: ClaimsClient): Promise<SessionClaims | null> {
  try {
    const { data, error } = await client.auth.getClaims();
    if (error) return null;

    const claims = data?.claims ?? {};
    const subject = subjectSchema.safeParse(claims.sub);
    if (!subject.success) return null;

    const email = emailSchema.safeParse(claims.email);
    const aal = assuranceLevelSchema.safeParse(claims.aal);

    return {
      sub: subject.data,
      email: email.success ? email.data : null,
      aal: aal.success ? aal.data : "aal1",
    };
  } catch {
    return null;
  }
}

/** Whether a level satisfies a requirement. */
export function meetsAssurance(actual: AssuranceLevel, required: AssuranceLevel): boolean {
  return required === "aal1" || actual === "aal2";
}
