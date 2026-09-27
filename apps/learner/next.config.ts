import type { NextConfig } from "next";

import { PRIVATE_PATHS } from "./lib/seo/private-paths";

/**
 * The header a crawler reads before it reads a page. The private rooms carry
 * it as well as the noindex meta tag, and the route handlers carry it because
 * they have no head to put a tag in.
 */
const NOT_FOR_CRAWLERS = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Workspace packages ship TypeScript source; Next compiles them alongside
  // the app instead of expecting a prebuilt dist.
  transpilePackages: [
    "@dp/auth",
    "@dp/billing",
    "@dp/db",
    "@dp/domain",
    "@dp/env",
    "@dp/gateway",
    "@dp/learning",
    "@dp/observability",
    "@dp/prompts",
    "@dp/ui",
  ],
  async headers() {
    const rooms = PRIVATE_PATHS.map((path) => path.slice(1)).join("|");
    return [
      // The bare path and everything under it: a matcher with :path* alone
      // does not cover the bare path.
      { source: `/:room(${rooms})`, headers: NOT_FOR_CRAWLERS },
      { source: `/:room(${rooms})/:path*`, headers: NOT_FOR_CRAWLERS },
    ];
  },
};

export default nextConfig;
