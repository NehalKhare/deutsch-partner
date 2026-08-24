import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCANNED_DIRS = ["app", "components", "lib", "domain", "learning", "repositories"];

/** Names that must never reach the browser bundle. */
const SERVER_SECRET_NAMES = [
  "SUPABASE_SECRET_KEY",
  "OPENROUTER_API_KEY",
  "LANGSMITH_API_KEY",
];

/** Modules that must never be imported from a Client Component. */
const SERVER_ONLY_MODULES = [
  "@/lib/env/server",
  "@/lib/supabase/server-client",
  "server-only",
  "next/headers",
];

/**
 * Only these files may read process.env directly. Everywhere else must go
 * through the validated accessors, so that no code path can quietly depend on
 * an unvalidated or absent variable.
 */
const PROCESS_ENV_ALLOWLIST = [
  join("lib", "env", "schema.ts"),
  join("lib", "env", "server.ts"),
  join("lib", "env", "client.ts"),
];

function sourceFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        found.push(full);
      }
    }
  };

  for (const dir of SCANNED_DIRS) walk(join(ROOT, dir));
  return found;
}

function read(file: string) {
  return { path: relative(ROOT, file), source: readFileSync(file, "utf8") };
}

function isClientComponent(source: string) {
  return /^\s*["']use client["']/m.test(source);
}

describe("client bundle cannot reach server secrets", () => {
  const files = sourceFiles().map(read);

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
      .filter((path) => !PROCESS_ENV_ALLOWLIST.includes(path.split("/").join(sep)));

    expect(offenders).toEqual([]);
  });
});

describe("domain purity", () => {
  const domainFiles = sourceFiles()
    .map(read)
    .filter((file) => file.path.startsWith(join("domain", "")));

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
  const repositoryFiles = sourceFiles()
    .map(read)
    .filter((file) => file.path.startsWith(join("repositories", "")));

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
    ["the learning layer", /from\s+["']@\/learning\//],
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

describe("repository secret hygiene", () => {
  /**
   * .env.example is committed, so it must never carry a credential. It may
   * carry non-secret defaults — that is what makes it a useful template.
   */
  const exampleEntries = readFileSync(join(ROOT, ".env.example"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return { key, value: rest.join("=").trim().replace(/^["']|["']$/g, "") };
    });

  /** Keys that identify or authenticate this project specifically. */
  const MUST_BE_EMPTY = [
    ...SERVER_SECRET_NAMES,
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ];

  it("declares every variable the schema requires", () => {
    const declared = exampleEntries.map((entry) => entry.key);

    for (const key of MUST_BE_EMPTY) {
      expect(declared).toContain(key);
    }
  });

  it.each(MUST_BE_EMPTY)("leaves %s empty", (key) => {
    const entry = exampleEntries.find((candidate) => candidate.key === key);

    expect(entry?.value ?? "").toBe("");
  });

  it("carries no credential-shaped value under any key", () => {
    const credentialShapes = [
      /^sb_(secret|publishable)_/i,
      /^sk[-_]/i,
      /^gh[pousr]_/i,
      /^eyJ[\w-]+\.[\w-]+\./,
      /^lsv2_/i,
      /^https:\/\/[a-z0-9]{15,}\.supabase\.co/i,
    ];

    const offenders = exampleEntries
      .filter((entry) =>
        credentialShapes.some((shape) => shape.test(entry.value)),
      )
      .map((entry) => entry.key);

    expect(offenders).toEqual([]);
  });

  it("ignores .env files but not the committed .env.example", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");

    expect(gitignore).toMatch(/^\.env\*?$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});
