import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSessionClaims, type SessionClaims } from "./claims";
import { cookieOptionsFor } from "./cookies";

/**
 * Session refresh and route guarding, run from an app's proxy.ts on every
 * request.
 *
 * Two rules, both learned the hard way:
 *
 *  1. Nothing happens between constructing the client and calling getClaims().
 *     Work inserted there is a documented cause of users being signed out at
 *     random.
 *  2. Cookies Supabase writes during the refresh are carried onto whatever
 *     response is returned, including a redirect. Dropping them throws away
 *     the token that was just issued.
 *
 * Which paths need a session, and where to send whom, is the app's decision
 * and is handed in as a pure function so it can be tested without a request.
 * The redirect is a convenience, not a security boundary: every app enforces
 * authorization again on the server, and the database enforces it regardless.
 */
export interface SessionRefresherConfig {
  /** Read at request time, so an app's env module stays the only reader of the environment. */
  readonly supabase: () => { readonly url: string; readonly publishableKey: string };
  readonly cookieName?: string;
  /** Where to send this request, or null to let it through. */
  readonly decide: (input: {
    readonly pathname: string;
    /** The query, "?" included, or "" — for remembering a destination, never for matching one. */
    readonly search: string;
    readonly session: SessionClaims | null;
  }) => string | null;
}

export function createSessionRefresher(config: SessionRefresherConfig) {
  return async function refreshSession(request: NextRequest): Promise<NextResponse> {
    let response = NextResponse.next({ request });
    const refreshed: Array<{
      name: string;
      value: string;
      options?: Record<string, unknown>;
    }> = [];

    let session: SessionClaims | null = null;

    try {
      const { url, publishableKey } = config.supabase();

      const supabase = createServerClient(url, publishableKey, {
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
        cookieOptions: cookieOptionsFor(config.cookieName),
      });

      // Nothing between the line above and the line below. See rule 1.
      session = await readSessionClaims(supabase);
    } catch {
      // An unreachable auth service must not become an open door.
      session = null;
    }

    const destination = config.decide({
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      session,
    });
    if (!destination) return response;

    const redirect = NextResponse.redirect(new URL(destination, request.url));
    // See rule 2: a redirect must not discard a token that was just refreshed.
    for (const { name, value, options } of refreshed) {
      redirect.cookies.set(name, value, options);
    }

    return redirect;
  };
}
