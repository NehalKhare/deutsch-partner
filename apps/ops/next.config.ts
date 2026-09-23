import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Workspace packages ship TypeScript source; Next compiles them alongside
  // the app instead of expecting a prebuilt dist.
  transpilePackages: [
    "@dp/auth",
    "@dp/db",
    "@dp/domain",
    "@dp/env",
    "@dp/observability",
    "@dp/product-ops",
    "@dp/ui",
  ],
};

export default nextConfig;
