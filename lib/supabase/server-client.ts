import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env/client";
import { requireEnvValue } from "@/lib/env/schema";
import { serverEnv } from "@/lib/env/server";

type CookieRecord = { name: string; value: string };
type CookieWrite = CookieRecord & { options?: Record<string, unknown> };

interface RequestCookieStore {
  getAll(): CookieRecord[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

/**
 * Bridges Supabase's cookie contract to the Next.js request cookie store.
 *
 * Writes are attempted and ignored on failure: during a Server Component
 * render the store is read-only, and the session refresh will be written by
 * middleware instead. Letting that throw would break otherwise valid renders.
 */
export function createCookieAdapter(store: RequestCookieStore) {
  return {
    getAll: () => store.getAll(),
    setAll: (cookiesToSet: CookieWrite[]) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options);
        }
      } catch {
        // Read-only store during an RSC render; middleware refreshes instead.
      }
    },
  };
}

/**
 * Request-scoped Supabase client acting as the signed-in user, built on the
 * publishable key. Row Level Security applies, which is what makes this the
 * default server client.
 */
export async function createServerSupabaseClient() {
  const env = clientEnv();
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { cookies: createCookieAdapter(cookieStore) },
  );
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
 * Privileged Supabase client, built on the Supabase secret key (the successor
 * to the legacy `service_role` key). Every call site needs a documented
 * reason; see security-observability-guardrails.md S4.
 */
export function createSecretKeySupabaseClient() {
  const env = clientEnv();
  const secretKey = requireEnvValue(
    serverEnv().SUPABASE_SECRET_KEY,
    "SUPABASE_SECRET_KEY",
  );

  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey,
    secretKeyClientOptions,
  );
}
