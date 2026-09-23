import "server-only";

import { cookies } from "next/headers";

import { requireEnvValue } from "@dp/env/schema";
import { createRequestScopedClient, createSecretClient } from "@dp/auth/supabase";

import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";

export { createCookieAdapter } from "@dp/auth/cookies";
export { secretKeyClientOptions } from "@dp/auth/supabase";

/**
 * Request-scoped Supabase client acting as the signed-in learner, built on the
 * publishable key. Row Level Security applies, which is what makes this the
 * default server client.
 */
export async function createServerSupabaseClient() {
  const env = clientEnv();

  return createRequestScopedClient({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    cookieStore: await cookies(),
  });
}

/**
 * Privileged Supabase client, built on the Supabase secret key. Every call
 * site needs a documented reason; see security-observability-guardrails.md S4.
 */
export function createSecretKeySupabaseClient() {
  const env = clientEnv();

  return createSecretClient({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: requireEnvValue(serverEnv().SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY"),
  });
}
