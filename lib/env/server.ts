import "server-only";

import { parseEnv, type AppEnv } from "@/lib/env/schema";

let cached: AppEnv | undefined;

/**
 * The validated server environment, including secrets. Importing this module
 * from a Client Component is a build error, and a CI test asserts it never
 * happens (see tests/security/secret-exposure.test.ts).
 */
export function serverEnv(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
