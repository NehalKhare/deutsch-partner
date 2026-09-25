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

/** What a public page needs to know about where, and whether, it is published. */
export interface SiteEnv {
  /** The canonical origin, for absolute URLs in the head, the sitemap and robots.txt. */
  readonly appUrl: string;
  /** Whether search and answer engines may index this deployment. */
  readonly indexing: boolean;
  /** Site-ownership tokens for the search consoles. Public by design. */
  readonly verification: { readonly google?: string; readonly bing?: string };
}

/**
 * The slice of the environment the public pages read while rendering.
 *
 * Parsed without the production-required list on purpose. The landing page,
 * robots.txt and the sitemap are rendered in places a model key is rightly
 * absent — `next build` inside a container that holds no secrets — and a
 * canonical URL must not need one. Malformed values still fail here, as they
 * do everywhere: wrong is not the same as absent. The boot-time guard in
 * serverEnv() is what refuses a production deployment missing its secrets.
 */
export function siteEnv(): SiteEnv {
  const env = parseEnv(process.env, { productionRequired: [] });
  return {
    appUrl: env.APP_URL,
    indexing: env.SEO_INDEXING,
    verification: {
      google: env.GOOGLE_SITE_VERIFICATION,
      bing: env.BING_SITE_VERIFICATION,
    },
  };
}
