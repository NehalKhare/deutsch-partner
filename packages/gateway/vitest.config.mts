import { defineConfig } from "vitest/config";

import { dbProject, nodeProject } from "@dp/config/vitest/base";

export default defineConfig({
  test: { projects: [nodeProject("gateway"), dbProject("gateway:db")] },
});
