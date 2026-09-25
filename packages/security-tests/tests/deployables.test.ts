import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, absolute, sourceFiles, under } from "../src/roots";

/**
 * What each deployable may hold.
 *
 * The split exists to draw three boundaries: only the learner app and the
 * worker call a model, only the worker touches the repository, and only the
 * operator app knows who an operator is. Each is enforced three ways — the
 * env schema at boot, the platform's secret bindings, and these assertions
 * over the committed templates, manifests and source.
 */

function envKeys(examplePath: string): string[] {
  return readFileSync(absolute(examplePath), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0]!);
}

function manifest(pkgDir: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(REPO_ROOT, pkgDir, "package.json"), "utf8"));
}

function allDependencies(pkgDir: string): string[] {
  const json = manifest(pkgDir);
  return Object.keys({ ...json.dependencies, ...json.devDependencies });
}

describe("the operator app", () => {
  const keys = envKeys("apps/ops/.env.example");

  it("holds no model key and no repository token", () => {
    expect(keys).not.toContain("OPENROUTER_API_KEY");
    expect(keys).not.toContain("GITHUB_TOKEN");
    expect(keys).not.toContain("GITHUB_REPOSITORY");
    expect(keys).not.toContain("MCP_SERVER_API_KEY");
  });

  it("is the only app that knows who an operator is", () => {
    expect(keys).toContain("OPERATOR_USER_IDS");
    expect(envKeys("apps/learner/.env.example")).not.toContain("OPERATOR_USER_IDS");
    expect(envKeys("apps/worker/.env.example")).not.toContain("OPERATOR_USER_IDS");
  });

  it("does not depend on the gateway or the prompt catalogue", () => {
    const deps = allDependencies("apps/ops");
    expect(deps).not.toContain("@dp/gateway");
    expect(deps).not.toContain("@dp/prompts");
    expect(deps.some((name) => name.startsWith("@langchain/") || name === "langchain")).toBe(false);
  });

  it("is never indexable, whatever the environment says", () => {
    // The learner app decides indexing from SEO_INDEXING. The operator app
    // has no such switch: a sign-in form in front of a product's internals
    // has no business in a search result or an answer engine, so the noindex
    // is written into the root layout and robots.txt turns everyone away.
    const layout = readFileSync(absolute("apps/ops/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/robots:\s*\{[^}]*index:\s*false/);

    const robots = readFileSync(absolute("apps/ops/app/robots.ts"), "utf8");
    expect(robots).toMatch(/disallow:\s*["']\/["']/);
    expect(robots).not.toMatch(/SEO_INDEXING|siteEnv|sitemap/);

    // Nothing that would describe the app to a crawler exists at all.
    for (const file of ["apps/ops/app/sitemap.ts", "apps/ops/app/llms.txt", "apps/ops/app/opengraph-image.tsx"]) {
      expect(existsSync(absolute(file)), file).toBe(false);
    }
  });

  it("names the model key nowhere in its source", () => {
    const offenders = sourceFiles()
      .filter((file) => under(file.path, "apps/ops"))
      .filter((file) => /OPENROUTER_API_KEY|GITHUB_TOKEN/.test(file.source))
      // The boot-time guard names them in order to refuse them.
      .filter((file) => file.path !== "apps/ops/lib/env/server.ts")
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe("the learner app", () => {
  it("holds no repository token and no allowlist", () => {
    const keys = envKeys("apps/learner/.env.example");
    expect(keys).not.toContain("GITHUB_TOKEN");
    expect(keys).not.toContain("OPERATOR_USER_IDS");
  });

  it("has no operator surface left", () => {
    const offenders = sourceFiles()
      .filter((file) => under(file.path, "apps/learner"))
      .filter((file) => /isOperator|OPERATOR_USER_IDS|\/operations\//.test(file.source))
      .filter((file) => file.path !== "apps/learner/lib/env/server.ts")
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("does not depend on the product-ops engine", () => {
    expect(allDependencies("apps/learner")).not.toContain("@dp/product-ops");
  });
});

describe("the worker", () => {
  it("is the only deployable that holds the repository token", () => {
    expect(envKeys("apps/worker/.env.example")).toContain("GITHUB_TOKEN");
    expect(envKeys("apps/worker/.env.example")).toContain("REPO_CHECKOUT_PATH");
  });

  it("serves no browser, so carries no publishable key", () => {
    expect(envKeys("apps/worker/.env.example")).not.toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });
});

describe("the salt", () => {
  it("is declared by every deployable, because pseudonyms must join across them", () => {
    for (const app of ["learner", "ops", "worker"]) {
      expect(envKeys(`apps/${app}/.env.example`), app).toContain("LOG_PSEUDONYM_SALT");
    }
  });
});

describe("the provider SDK", () => {
  it("is a dependency of the gateway package and nothing else", () => {
    const holders = ["apps/learner", "apps/ops", "apps/worker", "packages/gateway", "packages/product-ops", "packages/prompts", "packages/db"]
      .filter((dir) => allDependencies(dir).includes("@langchain/openai"));

    expect(holders).toEqual(["packages/gateway"]);
  });
});
