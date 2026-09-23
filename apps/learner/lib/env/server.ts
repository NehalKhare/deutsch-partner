import "server-only";

import { EnvValidationError, parseEnv, type AppEnv } from "@dp/env/schema";

let cached: AppEnv | undefined;

/**
 * Keys this app must never be given. Operators live in the operator app, and
 * the repository token lives in the worker; a learner deployment holding
 * either is misconfigured, and refusing to boot says so.
 */
export const FORBIDDEN_IN_LEARNER = ["OPERATOR_USER_IDS", "GITHUB_TOKEN"] as const;

/**
 * The validated server environment, including secrets. Importing this module
 * from a Client Component is a build error, and a CI test asserts it never
 * happens (see packages/security-tests).
 */
export function serverEnv(): AppEnv {
  if (cached) return cached;

  const env = parseEnv(process.env);
  const held = FORBIDDEN_IN_LEARNER.filter((key) => env[key] !== undefined);
  if (held.length > 0) {
    throw new EnvValidationError(held.map((key) => `${key}: must not be set for the learner app`));
  }

  cached = env;
  return cached;
}
