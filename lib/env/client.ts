import { z } from "zod";

import {
  describeIssue,
  EnvValidationError,
  SUPABASE_PUBLISHABLE_PREFIX,
  supabaseKeySchema,
} from "@/lib/env/schema";

/**
 * The browser-visible environment.
 *
 * Values are read as static `process.env.NEXT_PUBLIC_*` expressions because
 * Next.js inlines those at build time; a dynamic lookup would resolve to
 * undefined in the browser.
 *
 * These are required here even though the boot-time schema treats them as
 * optional: the app may start without Supabase configured, but code that
 * actually reaches for a Supabase URL cannot proceed without one.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKeySchema(
    SUPABASE_PUBLISHABLE_PREFIX,
    "publishable",
  ),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

let cached: ClientEnv | undefined;

export function clientEnv(): ClientEnv {
  if (cached) return cached;

  const result = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map(describeIssue));
  }

  cached = result.data;
  return cached;
}
