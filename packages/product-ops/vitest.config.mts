import { defineConfig } from "vitest/config";

import { dbProject, nodeProject } from "@dp/config/vitest/base";

export default defineConfig({
  test: { projects: [nodeProject("product-ops"), dbProject("product-ops:db")] },
});
