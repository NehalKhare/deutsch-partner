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
  "/billing",
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
 * ASCII control characters and the backslash. The WHATWG URL parser removes
 * tab, CR and LF before it resolves a URL and reads a backslash as "/" in
 * a path, so "/\t/evil.example" — which starts with exactly one slash — reaches
 * a browser as "//evil.example", another origin.
 */
const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u001F\u007F]/;

/** A same-site path by the naive rules and by the parser's, or null. */
function sameSitePath(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (UNSAFE_PATH_CHARACTERS.test(value)) return null;

  // Resolve against a placeholder origin and keep the result only when it
  // stayed there, so what is returned is what a browser would request.
  const base = new URL("https://same-origin.invalid");
  let resolved: URL;
  try {
    resolved = new URL(value, base);
  } catch {
    return null;
  }
  if (resolved.origin !== base.origin) return null;

  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  // "/a/../..//x" normalises to "//x": same origin to the parser here, a
  // protocol-relative URL once it is a Location header.
  return path.startsWith("//") ? null : path;
}

/**
 * Builds the sign-in URL, remembering where the learner was heading — the
 * path and its query, so an order link such as
 * /billing/checkout?offer=… survives the trip.
 *
 * The destination is only ever a same-site path. Anything that could point at
 * another origin is dropped rather than sanitised, because a redirect target
 * taken from a URL is a classic open-redirect vector.
 */
export function signInRedirectTarget(pathWithQuery: string): string {
  const path = pathWithQuery === "/" ? null : sameSitePath(pathWithQuery);

  return path ? `${LOGIN_PATH}?next=${encodeURIComponent(path)}` : LOGIN_PATH;
}

/**
 * Validates a `next` parameter before it is used as a redirect destination.
 *
 * Typed `unknown` on purpose: a query parameter that repeats reaches a page
 * as a string[], and a form field may be a File. Neither is a path.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || next === "") return DEFAULT_SIGNED_IN_PATH;

  return sameSitePath(next) ?? DEFAULT_SIGNED_IN_PATH;
}
