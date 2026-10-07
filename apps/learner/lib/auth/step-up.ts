import "server-only";

import { redirect } from "next/navigation";

import type { SessionClaims } from "@dp/auth/claims";

import { getSessionClaims } from "@/lib/auth/current-user";
import { safeNextPath, signInRedirectTarget } from "@/lib/auth/routes";

/**
 * The session the step-up pages and their actions work on.
 *
 * Exactly one kind of session may stand on those pages: a password without a
 * second factor. No session goes back to sign in, remembering where it was
 * heading; a session that already has its second factor has nothing to do
 * here and goes on to its destination. The same decision the proxy makes,
 * made again on the server because the proxy is a convenience.
 */
export async function requireStepUpSession(destination: string | undefined): Promise<SessionClaims> {
  const session = await getSessionClaims();
  if (!session) redirect(signInRedirectTarget(destination ?? "/"));
  if (session.aal === "aal2") redirect(safeNextPath(destination));

  return session;
}

/** A page's `next` query, as a validated destination or nothing at all. */
export function destinationFromQuery(next: string | string[] | undefined): string | undefined {
  // A repeated `next` arrives as a list, which names no one destination.
  return typeof next === "string" && next !== "" ? safeNextPath(next) : undefined;
}
