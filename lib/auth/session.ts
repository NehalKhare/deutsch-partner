import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { clientEnv } from "@/lib/env/client";
import {
  DEFAULT_SIGNED_IN_PATH,
  isAuthPath,
  isProtectedPath,
  signInRedirectTarget,
} from "@/lib/auth/routes";

/**
 * Session refresh and route guarding, run from proxy.ts on every request.
 *
 * Two rules, both learned the hard way:
 *
 *  1. Nothing happens between constructing the client and calling getClaims().
 *     Work inserted there is a documented cause of learners being signed out
 *     at random.
 *  2. Cookies Supabase writes during the refresh are carried onto whatever
 *     response is returned, including a redirect. Dropping them throws away
 *     the token that was just issued.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const refreshed: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];

  let userId: string | null = null;

  try {
    const env = clientEnv();

    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookiesToSet) => {
            for (const cookie of cookiesToSet) {
              refreshed.push(cookie);
              request.cookies.set(cookie.name, cookie.value);
            }
            response = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      },
    );

    // Nothing between the line above and the line below. See rule 1.
    const { data, error } = await supabase.auth.getClaims();

    const subject = data?.claims?.sub;
    userId = !error && typeof subject === "string" ? subject : null;
  } catch {
    // An unreachable auth service must not become an open door.
    userId = null;
  }

  const { pathname } = request.nextUrl;

  const destination = !userId && isProtectedPath(pathname)
    ? signInRedirectTarget(pathname)
    : userId && isAuthPath(pathname)
      ? DEFAULT_SIGNED_IN_PATH
      : null;

  if (!destination) return response;

  const redirect = NextResponse.redirect(new URL(destination, request.url));
  // See rule 2: a redirect must not discard a token that was just refreshed.
  for (const { name, value, options } of refreshed) {
    redirect.cookies.set(name, value, options);
  }

  return redirect;
}
