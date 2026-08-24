import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const resolve = {
  // Resolves the "@/*" paths declared in tsconfig.json.
  tsconfigPaths: true,
  alias: {
    // `server-only` throws when resolved outside a React Server Component
    // bundler. Under Vitest we only need the marker to be inert.
    "server-only": new URL(
      "./node_modules/server-only/empty.js",
      import.meta.url,
    ).pathname,
  },
};

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        plugins: [react()],
        resolve,
        test: {
          name: "unit",
          environment: "jsdom",
          globals: false,
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/**/*.test.{ts,tsx}"],
          exclude: ["tests/db/**", "tests/e2e/**"],
          clearMocks: true,
          restoreMocks: true,
          unstubEnvs: true,
        },
      },
      {
        resolve,
        test: {
          name: "db",
          // Each file boots its own Postgres (PGlite, WebAssembly). Running
          // them concurrently starves the instances, so this project runs in a
          // single process with a timeout that fits engine startup.
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          // Files run one at a time; concurrent engines starve each other.
          fileParallelism: false,
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
