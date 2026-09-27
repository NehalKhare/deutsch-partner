import { createSessionRefresher } from "@dp/auth/session";

import {
  DEFAULT_SIGNED_IN_PATH,
  isAuthPath,
  isProtectedPath,
  signInRedirectTarget,
} from "@/lib/auth/routes";
import { clientEnv } from "@/lib/env/client";

/**
 * Session refresh and route guarding for the learner app, run from proxy.ts.
 *
 * A signed-out visitor on a protected page is sent to sign in, remembering
 * where they were heading — path and query, since an order page is named by
 * its query; a signed-in learner on an auth page is sent on. Which pages are
 * protected is decided on the path alone.
 * Everything else passes. See @dp/auth/session for the two rules the refresh
 * itself obeys.
 */
export const updateSession = createSessionRefresher({
  supabase: () => {
    const env = clientEnv();
    return { url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  },
  decide: ({ pathname, search, session }) => {
    if (!session && isProtectedPath(pathname)) return signInRedirectTarget(`${pathname}${search}`);
    if (session && isAuthPath(pathname)) return DEFAULT_SIGNED_IN_PATH;
    return null;
  },
});
