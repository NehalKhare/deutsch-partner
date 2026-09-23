import { createSessionRefresher } from "@dp/auth/session";

import { OPS_COOKIE_NAME, opsRouteDecision } from "@/lib/auth/routes";
import { clientEnv } from "@/lib/env/client";

/** Session refresh and step-up routing for the operator app, run from proxy.ts. */
export const updateSession = createSessionRefresher({
  supabase: () => {
    const env = clientEnv();
    return { url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  },
  cookieName: OPS_COOKIE_NAME,
  decide: ({ pathname, session }) =>
    opsRouteDecision(pathname, { signedIn: session !== null, aal: session?.aal ?? "aal1" }),
});
