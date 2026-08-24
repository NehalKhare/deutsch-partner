import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env/client";

/**
 * Supabase client for Client Components. Uses the publishable key, so every
 * query it makes is subject to Row Level Security.
 */
export function createBrowserSupabaseClient() {
  const env = clientEnv();

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
