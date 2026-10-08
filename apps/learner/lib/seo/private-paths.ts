/**
 * Where a crawler is told not to go.
 *
 * Every room behind sign-in, the onboarding form and the route handlers. A
 * crawler that reached one would only be redirected to sign-in, but a
 * redirected URL still gets crawled, still spends a request, and can still be
 * listed — so it is disallowed in robots.txt, marked noindex in the page head
 * and answered with an X-Robots-Tag header, three ways because none of the
 * three is honoured by every bot.
 *
 * Plain constants with no imports, because next.config.ts reads this file
 * too and the config is compiled before any path alias exists.
 */
export const PRIVATE_PATHS = [
  "/api",
  "/billing",
  "/chat",
  "/curriculum",
  "/dashboard",
  "/notifications",
  "/onboarding",
  "/review",
  "/scenarios",
  "/settings",
  "/trainer",
] as const;

export type PrivatePath = (typeof PRIVATE_PATHS)[number];
