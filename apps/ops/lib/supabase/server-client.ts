import "server-only";

import { cookies } from "next/headers";

import { requireEnvValue } from "@dp/env/schema";
import { createRequestScopedClient, createSecretClient } from "@dp/auth/supabase";

import { OPS_COOKIE_NAME } from "@/lib/auth/routes";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";

/**
 * Request-scoped client acting as the signed-in operator, on the publishable
 * key and under this app's own cookie name. Used for identity and for the
 * second factor; never for the operator tables, which have no policies.
 */
export async function createServerSupabaseClient() {
  const env = clientEnv();

  return createRequestScopedClient({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    cookieStore: await cookies(),
    cookieName: OPS_COOKIE_NAME,
  });
}

/**
 * The secret key: the only way to the product-ops, accounting and queue
 * tables, all of which have RLS enabled with no policy at all. Every call
 * site sits behind an operator check; see security-observability-guardrails.md S4.
 */
export function createSecretKeySupabaseClient() {
  const env = clientEnv();

  return createSecretClient({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: requireEnvValue(serverEnv().SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY"),
  });
}
