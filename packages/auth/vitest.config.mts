import { defineConfig } from "vitest/config";

import { nodeProject } from "@dp/config/vitest/base";

export default defineConfig({
  test: { projects: [nodeProject("auth")] },
});
