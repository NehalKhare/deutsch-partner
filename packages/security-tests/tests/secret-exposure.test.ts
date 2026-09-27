import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, ROOTS, absolute, sourceFiles, under } from "../src/roots";

/** Names that must never reach the browser bundle. */
const SERVER_SECRET_NAMES = [
  "SUPABASE_SECRET_KEY",
  "OPENROUTER_API_KEY",
  "LANGSMITH_API_KEY",
  // The credential a coding agent's work is ultimately pushed with. It is read
  // by the worker and by nothing the browser ever loads.
  "GITHUB_TOKEN",
  // The OTLP gateway's basic-auth credential.
  "OTEL_EXPORTER_OTLP_HEADERS",
  // The key that takes money and the secret that proves an event is
  // Stripe's. Hosted Checkout needs nothing in the browser at all.
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

/** Modules that must never be imported from a Client Component. */
const SERVER_ONLY_MODULES: readonly string[] = ROOTS.serverOnlyModules;

/**
 * Only these files may read process.env directly. Everywhere else must go
 * through the validated accessors, so that no code path can quietly depend on
 * an unvalidated or absent variable.
 */
const PROCESS_ENV_ALLOWLIST: readonly string[] = ROOTS.processEnvReaders;

function isClientComponent(source: string) {
  return /^\s*["']use client["']/m.test(source);
}

describe("client bundle cannot reach server secrets", () => {
  const files = sourceFiles();

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(SERVER_SECRET_NAMES)(
    "keeps %s out of every Client Component",
    (secret) => {
      const offenders = files
        .filter((file) => isClientComponent(file.source))
        .filter((file) => file.source.includes(secret))
        .map((file) => file.path);

      expect(offenders).toEqual([]);
    },
  );

  it.each(SERVER_ONLY_MODULES)(
    "keeps %s out of every Client Component",
    (moduleName) => {
      const importPattern = new RegExp(
        `from\\s+["']${moduleName.replace(/[/@]/g, "\\$&")}["']`,
      );
      const offenders = files
        .filter((file) => isClientComponent(file.source))
        .filter((file) => importPattern.test(file.source))
        .map((file) => file.path);

      expect(offenders).toEqual([]);
    },
  );

  it("never prefixes a server secret with NEXT_PUBLIC_", () => {
    const offenders = files
      .filter((file) =>
        SERVER_SECRET_NAMES.some((secret) =>
          file.source.includes(`NEXT_PUBLIC_${secret}`),
        ),
      )
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("reads process.env only from the environment modules", () => {
    const offenders = files
      .filter((file) => file.source.includes("process.env"))
      .map((file) => file.path)
      .filter((path) => !PROCESS_ENV_ALLOWLIST.includes(path));

    expect(offenders).toEqual([]);
  });
});

describe("domain purity", () => {
  const domainFiles = sourceFiles().filter((file) => under(file.path, ROOTS.domain));

  it("finds domain files to scan", () => {
    expect(domainFiles.length).toBeGreaterThan(0);
  });

  it.each([
    ["react", /from\s+["']react["']/],
    ["next", /from\s+["']next\//],
    ["a provider SDK", /from\s+["']@(supabase|langchain)\//],
    ["the environment", /serverEnv|clientEnv/],
  ])("keeps %s out of the domain layer", (_label, pattern) => {
    const offenders = domainFiles
      .filter((file) => pattern.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe("repository layer purity", () => {
  const repositoryFiles = sourceFiles().filter((file) =>
    ROOTS.repositories.some((root) => under(file.path, root)),
  );

  it("finds repository files to scan", () => {
    expect(repositoryFiles.length).toBeGreaterThan(0);
  });

  it.each([
    ["react", /from\s+["']react["']/],
    ["next", /from\s+["']next\//],
    ["the supabase SDK", /from\s+["']@supabase\//],
    ["the environment", /serverEnv|clientEnv/],
    // Repositories sit below the learning layer. A repository reaching up into
    // it would make the rules depend on storage and storage on the rules.
    ["the learning layer", /from\s+["'](@\/learning\/|@dp\/learning)/],
  ])("keeps %s out of the repository layer", (_label, pattern) => {
    const offenders = repositoryFiles
      .filter((file) => pattern.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("never embeds a raw database message in a caller-facing error", () => {
    // Safe messages live in one table in errors.ts; nothing else should be
    // constructing user-visible text from a driver error.
    const offenders = repositoryFiles
      .filter((file) => !file.path.endsWith("errors.ts"))
      .filter((file) => /error\.message|error\.details|error\.hint/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe.each(ROOTS.envExamples)("%s", (examplePath) => {
  /**
   * .env.example is committed, so it must never carry a credential. It may
   * carry non-secret defaults — that is what makes it a useful template.
   */
  const exampleEntries = readFileSync(absolute(examplePath), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return { key, value: rest.join("=").trim().replace(/^["']|["']$/g, "") };
    });

  const declared = exampleEntries.map((entry) => entry.key);

  it("declares the project-identifying keys it uses, empty", () => {
    // A template declares the keys a deployment needs, so a new contributor
    // knows what to set; which keys those are differs per deployable and is
    // asserted by the manifest test. Here: whatever it declares of these, it
    // leaves empty.
    const identifying = [
      ...SERVER_SECRET_NAMES,
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ].filter((key) => declared.includes(key));

    expect(identifying.length).toBeGreaterThan(0);
    for (const key of identifying) {
      const entry = exampleEntries.find((candidate) => candidate.key === key);
      expect(entry?.value ?? "", key).toBe("");
    }
  });

  it("carries no credential-shaped value under any key", () => {
    const credentialShapes = [
      /^sb_(secret|publishable)_/i,
      /^sk[-_]/i,
      // Stripe's restricted keys, webhook signing secrets and publishable
      // keys. The last is not a secret, but a real one in a template is a
      // real account named in the repository.
      /^rk_/i,
      /^whsec_/i,
      /^pk_(test|live)_/i,
      /^gh[pousr]_/i,
      /^eyJ[\w-]+\.[\w-]+\./,
      /^lsv2_/i,
      /^https:\/\/[a-z0-9]{15,}\.supabase\.co/i,
    ];

    const offenders = exampleEntries
      .filter((entry) => credentialShapes.some((shape) => shape.test(entry.value)))
      .map((entry) => entry.key);

    expect(offenders).toEqual([]);
  });
});

describe("repository secret hygiene", () => {
  it("has a template beside every deployable", () => {
    for (const examplePath of ROOTS.envExamples) {
      expect(existsSync(absolute(examplePath)), examplePath).toBe(true);
    }
  });

  it("ignores .env files but not the committed .env.example", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");

    expect(gitignore).toMatch(/^\.env\*?$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});
