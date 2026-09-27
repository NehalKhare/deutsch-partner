import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/auth/session";

/**
 * Runs before every matched request: refreshes the Supabase session and sends
 * signed-out visitors to the sign-in page.
 *
 * This file is `proxy.ts`, not `middleware.ts`. Next.js 16 deprecated the
 * middleware convention and renamed it; most Supabase examples still show the
 * old name.
 *
 * The redirect here is a convenience, not a security boundary. Authorization
 * is enforced by Row Level Security in the database, which applies whether or
 * not a request ever passes through this file.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets, image files, and the files a crawler
  // asks for. Without this the guard would also intercept CSS, JS and images;
  // and a session refresh — a round trip to Supabase — on every robots.txt
  // fetch is a round trip spent on a visitor who has no session to refresh.
  // Stripe's webhook is the same case: a server calling a server, whose
  // signature is its authentication, with no cookie to refresh or write.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/billing/webhook$|(?:robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|llms\\.txt|opengraph-image|twitter-image|apple-icon|icon)$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
