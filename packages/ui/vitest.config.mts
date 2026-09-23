import { defineConfig } from "vitest/config";

import { jsdomProject } from "@dp/config/vitest/base";

// The shared setup brings the jest-dom matchers and, more importantly, the
// cleanup between tests: without it a second render finds the first one still
// mounted and every query that expects one element finds two.
export default defineConfig({
  test: { projects: [jsdomProject("ui", { setupFiles: ["./tests/setup.ts"] })] },
});
