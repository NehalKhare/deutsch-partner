import { defineConfig } from "vitest/config";

import { dbProject, jsdomProject, serverOnlyAlias } from "@dp/config/vitest/base";

// Resolves the "@/*" paths declared in tsconfig.json, and keeps the shared
// `server-only` stub the base projects carry.
const resolve = { tsconfigPaths: true, alias: serverOnlyAlias };

export default defineConfig({
  resolve,
  test: {
    projects: [
      { ...jsdomProject("unit", { setupFiles: ["./tests/setup.ts"], testTimeout: 20_000 }), resolve },
      { ...dbProject("db"), resolve },
    ],
  },
});
