import type { AssuranceLevel } from "@dp/auth/claims";

/**
 * Where a request goes, decided from the path and the session alone.
 *
 * Pure, so the table below is testable without a request. Redirecting is a
 * convenience: every page checks the allowlist and the assurance level again.
 */

export const LOGIN_PATH = "/login";
export const MFA_PATH = "/login/mfa";
export const ENROL_PATH = "/mfa/enrol";
export const HOME_PATH = "/product";

/** The session cookie's name. See @dp/auth/cookies for why it is distinct. */
export const OPS_COOKIE_NAME = "dp-ops-auth";

/** Pages that exist to get a session. */
const PUBLIC_PATHS = [LOGIN_PATH] as const;
/** Pages for a session that has a password but not yet a second factor. */
const STEP_UP_PATHS = [MFA_PATH, ENROL_PATH] as const;

function normalise(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export interface RouteSession {
  readonly signedIn: boolean;
  readonly aal: AssuranceLevel;
}

/**
 * | session        | /login   | /login/mfa, /mfa/enrol | everything else |
 * | -------------- | -------- | ---------------------- | --------------- |
 * | none           | pass     | → /login               | → /login        |
 * | password only  | → mfa    | pass                   | → /login/mfa    |
 * | second factor  | → home   | → home                 | pass            |
 *
 * Route handlers under /api authenticate themselves and are never redirected.
 * There is no `next` parameter: few pages, and an open redirect is a surface
 * this app does not need.
 */
export function opsRouteDecision(pathname: string, session: RouteSession): string | null {
  const path = normalise(pathname);
  if (path.startsWith("/api/")) return null;

  const isPublic = (PUBLIC_PATHS as readonly string[]).includes(path);
  const isStepUp = (STEP_UP_PATHS as readonly string[]).includes(path);

  if (!session.signedIn) return isPublic ? null : LOGIN_PATH;
  if (session.aal === "aal2") return isPublic || isStepUp ? HOME_PATH : null;
  // A password but no second factor yet.
  if (isPublic) return MFA_PATH;
  return isStepUp ? null : MFA_PATH;
}
