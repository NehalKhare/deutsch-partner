import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Next puts its dev-tools badge bottom-left by default, which is exactly
  // where the operator rail's account menu sits — it covered the button and
  // the menu could not be opened while developing.
  devIndicators: { position: "bottom-right" },
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
