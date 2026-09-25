import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/auth/session";

/**
 * Runs before every matched request: refreshes the Supabase session and sends
 * visitors to the right step — sign in, or the second factor.
 *
 * This file is `proxy.ts`, not `middleware.ts`. Next.js 16 deprecated the
 * middleware convention and renamed it.
 *
 * The redirect here is a convenience, not a security boundary. Every page,
 * action and route handler checks the operator allowlist and the assurance
 * level again on the server, and the database enforces access regardless.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets, image files, the health check and
  // robots.txt — which tells every crawler to leave, and needs no session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|robots\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
