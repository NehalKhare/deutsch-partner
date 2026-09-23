import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { TestProjectInlineConfiguration } from "vitest/config";

/**
 * `server-only` throws when resolved outside a React Server Component
 * bundler. Under Vitest the marker only needs to be inert. Resolved from this
 * package so every workspace finds the same file under pnpm's per-package
 * node_modules.
 */
export const serverOnlyAlias = {
  // The package exports no subpath, so it is reached by file path from this
  // package's own node_modules, where pnpm links the dependency declared here.
  "server-only": fileURLToPath(
    new URL("../node_modules/server-only/empty.js", import.meta.url),
  ),
};

const common = {
  globals: false,
  clearMocks: true,
  restoreMocks: true,
  unstubEnvs: true,
} as const;

/** Plain Node tests: pure logic, repositories against fakes, workers. */
export function nodeProject(
  name: string,
  overrides: Partial<TestProjectInlineConfiguration["test"]> = {},
): TestProjectInlineConfiguration {
  return {
    resolve: { alias: serverOnlyAlias },
    test: {
      name,
      environment: "node",
      include: ["tests/**/*.test.{ts,tsx}"],
      exclude: ["tests/db/**", "tests/e2e/**"],
      ...common,
      ...overrides,
    },
  };
}

/** Component tests on jsdom with React Testing Library and MSW. */
export function jsdomProject(
  name: string,
  overrides: Partial<TestProjectInlineConfiguration["test"]> = {},
): TestProjectInlineConfiguration {
  return {
    plugins: [react()],
    resolve: { alias: serverOnlyAlias },
    test: {
      name,
      environment: "jsdom",
      include: ["tests/**/*.test.{ts,tsx}"],
      exclude: ["tests/db/**", "tests/e2e/**"],
      ...common,
      ...overrides,
    },
  };
}

/**
 * Tests against a real Postgres (PGlite, WebAssembly). Each file boots its own
 * engine, and concurrent engines starve each other, so files run one at a
 * time with timeouts that fit engine startup.
 */
export function dbProject(
  name = "db",
  overrides: Partial<TestProjectInlineConfiguration["test"]> = {},
): TestProjectInlineConfiguration {
  return {
    resolve: { alias: serverOnlyAlias },
    test: {
      name,
      environment: "node",
      include: ["tests/db/**/*.test.ts"],
      fileParallelism: false,
      hookTimeout: 60_000,
      testTimeout: 30_000,
      ...overrides,
    },
  };
}
