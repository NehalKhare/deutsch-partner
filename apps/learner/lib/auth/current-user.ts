import "server-only";

import { redirect } from "next/navigation";

import { readSessionClaims, type SessionClaims } from "@dp/auth/claims";

import { LOGIN_PATH, MFA_PATH } from "@/lib/auth/routes";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

export interface AuthenticatedAccount {
  readonly id: string;
  /** Null when the token carries none: not every sign-in method has one. */
  readonly email: string | null;
}

/**
 * The session as the token states it, at whatever assurance level, or null.
 *
 * For the step-up pages and nothing else: they are the one place a password
 * without a second factor is allowed to stand. Everything else in the app
 * asks the functions below, which do not return until the second factor is
 * present.
 */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  try {
    return await readSessionClaims(await createServerSupabaseClient());
  } catch {
    return null;
  }
}

/**
 * The signed-in account, or null.
 *
 * Derived from a verified token, never from a request body or a client-supplied
 * parameter. getClaims verifies the JWT against the project's signing keys —
 * locally where asymmetric keys are configured — so this is safe to use as the
 * identity the rest of a request is scoped to.
 *
 * A password alone is not an account here. The session has to have answered
 * its authenticator (aal2), and because every page, action and route handler
 * reads its learner through this one function, a password-only session can
 * open nothing — not a page the proxy forgot, not a fetch to /api/chat.
 *
 * The address rides along because the shell shows it back: knowing which
 * account you are in is the point of putting a name in a nav bar, and reading
 * it from the same verified claim as the id means the two cannot disagree.
 */
export async function getAuthenticatedAccount(): Promise<AuthenticatedAccount | null> {
  const session = await getSessionClaims();
  if (!session || session.aal !== "aal2") return null;

  return { id: session.sub, email: session.email };
}

/** The id alone, which is what almost every caller scopes a query to. */
export async function getAuthenticatedUserId(): Promise<string | null> {
  return (await getAuthenticatedAccount())?.id ?? null;
}

/**
 * As above, but sends the learner on instead of returning null: to sign in
 * when there is no session, to their authenticator when there is only a
 * password.
 */
export async function requireAuthenticatedAccount(): Promise<AuthenticatedAccount> {
  const session = await getSessionClaims();
  if (!session) redirect(LOGIN_PATH);
  if (session.aal !== "aal2") redirect(MFA_PATH);

  return { id: session.sub, email: session.email };
}

/** The id alone, or a redirect. */
export async function requireAuthenticatedUserId(): Promise<string> {
  return (await requireAuthenticatedAccount()).id;
}
