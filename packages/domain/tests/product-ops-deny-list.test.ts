import { describe, expect, it } from "vitest";

import { isDeniedPath } from "../src/product-ops";

/**
 * The deny-list overrides the approved plan. These are the paths a quick
 * approval must never let through, spelled as the monorepo spells them.
 */
describe("the deny-list", () => {
  it.each([
    ".env",
    ".env.local",
    "apps/ops/.env.local",
    "apps/learner/.env.example",
    "packages/env/src/schema.ts",
    "apps/ops/lib/env/server.ts",
    "packages/db/supabase/migrations/20260101000000_x.sql",
    ".github/workflows/ci.yml",
    "docker/worker.Dockerfile",
    ".dockerignore",
    "package.json",
    "apps/learner/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "packages/gateway/src/gateway.ts",
    "packages/prompts/src/catalogue.ts",
    "packages/auth/src/session.ts",
    "packages/security-tests/src/roots.ts",
    "apps/worker/src/main.ts",
    "apps/learner/proxy.ts",
    "apps/ops/proxy.ts",
  ])("refuses %s", (path) => {
    expect(isDeniedPath(path)).toBe(true);
  });

  it.each([
    "apps/learner/app/page.tsx",
    "apps/learner/lib/trainer/agenda.ts",
    "packages/domain/src/cefr.ts",
    "packages/product-ops/src/view.ts",
    "packages/learning/src/curriculum.ts",
    "docs/architecture.md",
    "apps/ops/components/operations/runs-panel.tsx",
  ])("allows %s", (path) => {
    expect(isDeniedPath(path)).toBe(false);
  });
});
