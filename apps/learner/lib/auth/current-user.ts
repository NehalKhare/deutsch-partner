import "server-only";

import { redirect } from "next/navigation";
import { z } from "zod";

import { LOGIN_PATH } from "@/lib/auth/routes";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

const subjectSchema = z.uuid();

/** The address is shown back to its owner, so a malformed one is simply absent. */
const emailSchema = z.email().max(320);

export interface AuthenticatedAccount {
  readonly id: string;
  /** Null when the token carries none: not every sign-in method has one. */
  readonly email: string | null;
}

/**
 * The signed-in account, or null.
 *
 * Derived from a verified token, never from a request body or a client-supplied
 * parameter. getClaims verifies the JWT against the project's signing keys —
 * locally where asymmetric keys are configured — so this is safe to use as the
 * identity the rest of a request is scoped to.
 *
 * The address rides along because the shell shows it back: knowing which
 * account you are in is the point of putting a name in a nav bar, and reading
 * it from the same verified claim as the id means the two cannot disagree.
 */
export async function getAuthenticatedAccount(): Promise<AuthenticatedAccount | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;

    // The claim selects which learner's rows we read, so it must be the shape
    // the database expects, not merely present.
    const subject = subjectSchema.safeParse(data?.claims?.sub);
    if (!subject.success) return null;

    const email = emailSchema.safeParse(data?.claims?.email);

    return { id: subject.data, email: email.success ? email.data : null };
  } catch {
    return null;
  }
}

/** The id alone, which is what almost every caller scopes a query to. */
export async function getAuthenticatedUserId(): Promise<string | null> {
  return (await getAuthenticatedAccount())?.id ?? null;
}

/** As above, but sends the learner to sign in instead of returning null. */
export async function requireAuthenticatedUserId(): Promise<string> {
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect(LOGIN_PATH);

  return userId;
}
