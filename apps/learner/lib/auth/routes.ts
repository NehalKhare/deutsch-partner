/**
 * Route classification.
 *
 * Pure string logic with no framework types, so the rules that decide who is
 * sent where are testable on their own. Note that redirecting is a UX
 * affordance, not the security boundary: the database enforces access through
 * RLS whether or not a request ever reaches the proxy.
 */

export const LOGIN_PATH = "/auth/login";
export const SIGN_UP_PATH = "/auth/sign-up";
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/** Prefixes that require a session. API routes authenticate themselves. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/chat",
  "/review",
  "/settings",
] as const;

/** Pages that exist to get a session, so a signed-in learner is sent onward. */
const AUTH_PREFIXES = [LOGIN_PATH, SIGN_UP_PATH] as const;

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  const normalised =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  // Prefix plus a boundary, so "/dashboardish" does not match "/dashboard".
  return prefixes.some(
    (prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`),
  );
}

export function isProtectedPath(pathname: string): boolean {
  return matchesPrefix(pathname, PROTECTED_PREFIXES);
}

export function isAuthPath(pathname: string): boolean {
  // /auth/callback is deliberately excluded: redirecting away from it would
  // abort the code exchange that establishes the session.
  return matchesPrefix(pathname, AUTH_PREFIXES);
}

/**
 * Builds the sign-in URL, remembering where the learner was heading.
 *
 * The destination is only ever a same-site path. Anything that could point at
 * another origin is dropped rather than sanitised, because a redirect target
 * taken from a URL is a classic open-redirect vector.
 */
export function signInRedirectTarget(pathname: string): string {
  const isSafeInternalPath =
    pathname.startsWith("/") &&
    !pathname.startsWith("//") &&
    pathname !== "/" &&
    !pathname.includes("\\");

  return isSafeInternalPath
    ? `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`
    : LOGIN_PATH;
}

/** Validates a `next` parameter before it is used as a redirect destination. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_SIGNED_IN_PATH;

  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : DEFAULT_SIGNED_IN_PATH;
}
