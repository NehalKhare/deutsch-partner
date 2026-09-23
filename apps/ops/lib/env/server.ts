import "server-only";

import { EnvValidationError, parseEnv, type AppEnv } from "@dp/env/schema";

let cached: AppEnv | undefined;

/**
 * Keys this app must never be given. The operator app makes no model call and
 * touches no repository; a deployment that hands it either key has crossed a
 * boundary the split exists to draw, and refusing to boot is the loud failure
 * the guardrails ask for.
 */
export const FORBIDDEN_IN_OPS = ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "MCP_SERVER_API_KEY"] as const;

/**
 * The validated server environment, including secrets. Importing this module
 * from a Client Component is a build error, and a CI test asserts it never
 * happens.
 */
export function serverEnv(): AppEnv {
  if (cached) return cached;

  // What an operator deployment cannot run without. No model key: it makes no
  // model call. The allowlist is required because an operator app nobody can
  // enter is a misconfiguration, not a safe default.
  const env = parseEnv(process.env, {
    productionRequired: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "LOG_PSEUDONYM_SALT",
      "OPERATOR_USER_IDS",
    ],
  });
  const held = FORBIDDEN_IN_OPS.filter((key) => env[key] !== undefined);
  if (held.length > 0) {
    throw new EnvValidationError(held.map((key) => `${key}: must not be set for the operator app`));
  }

  cached = env;
  return cached;
}
