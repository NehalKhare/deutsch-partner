import { defineConfig } from "vitest/config";

import { jsdomProject } from "@dp/config/vitest/base";

export default defineConfig({
  test: { projects: [jsdomProject("ui")] },
});
