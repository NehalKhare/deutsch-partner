import { defineConfig } from "vitest/config";

import { dbProject, nodeProject, serverOnlyAlias } from "@dp/config/vitest/base";

// Resolves the "@/*" paths declared in tsconfig.json.
const resolve = { tsconfigPaths: true, alias: serverOnlyAlias };

export default defineConfig({
  resolve,
  test: {
    projects: [
      { ...nodeProject("worker"), resolve },
      { ...dbProject("worker:db"), resolve },
    ],
  },
});
