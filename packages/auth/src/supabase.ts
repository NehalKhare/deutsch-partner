import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { cookieOptionsFor, createCookieAdapter, type RequestCookieStore } from "./cookies";

export interface RequestScopedClientConfig {
  readonly url: string;
  readonly publishableKey: string;
  readonly cookieStore: RequestCookieStore;
  /** See cookieOptionsFor. */
  readonly cookieName?: string;
}

/**
 * A Supabase client acting as the signed-in user, built on the publishable
 * key. Row Level Security applies, which is what makes this the default
 * server client in every app.
 */
export function createRequestScopedClient(config: RequestScopedClientConfig) {
  return createServerClient(config.url, config.publishableKey, {
    cookies: createCookieAdapter(config.cookieStore),
    cookieOptions: cookieOptionsFor(config.cookieName),
  });
}

/**
 * The secret key bypasses Row Level Security entirely. No session is persisted
 * or refreshed because this client acts for the system, never a user.
 */
export const secretKeyClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
} as const;

/**
 * A privileged client on the secret key (the successor to the legacy
 * `service_role` key). Every call site needs a documented reason; see
 * security-observability-guardrails.md S4.
 */
export function createSecretClient(config: { readonly url: string; readonly secretKey: string }) {
  return createClient(config.url, config.secretKey, secretKeyClientOptions);
}
