import { defineConfig } from "vitest/config";

import { jsdomProject, serverOnlyAlias } from "@dp/config/vitest/base";

// Resolves the "@/*" paths declared in tsconfig.json, and keeps the shared
// `server-only` stub the base project carries.
const resolve = { tsconfigPaths: true, alias: serverOnlyAlias };

export default defineConfig({
  resolve,
  test: {
    projects: [{ ...jsdomProject("ops", { setupFiles: ["./tests/setup.ts"] }), resolve }],
  },
});
