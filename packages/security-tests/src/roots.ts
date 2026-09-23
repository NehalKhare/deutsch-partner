import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/**
 * Where each boundary rule looks.
 *
 * The rules themselves are stated in the tests; this file is the one place
 * that knows the workspace layout. When a directory moves, this is the edit,
 * and the tests keep asserting the same thing about the new location.
 *
 * Every path is repository-relative and written with forward slashes.
 */

/** The repository root: the nearest ancestor holding the workspace manifest. */
export const REPO_ROOT = (() => {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found above " + process.cwd());
    dir = parent;
  }
  return dir;
})();

/** Every `packages/<name>/src` that exists, so a new package is scanned by default. */
function packageSourceRoots(): string[] {
  const packagesDir = join(REPO_ROOT, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    // The rules' own configuration is not product code.
    .filter((name) => name !== "security-tests")
    .map((name) => `packages/${name}/src`)
    .filter((root) => existsSync(join(REPO_ROOT, root)));
}

const LEARNER = "apps/learner";
const OPS = "apps/ops";
const WORKER = "apps/worker";
const GATEWAY = "packages/gateway/src";
const VOICE = `${GATEWAY}/voice`;
const PROMPTS = "packages/prompts/src";

export const ROOTS = {
  /** Directories whose TypeScript every boundary rule applies to. */
  source: [
    `${LEARNER}/app`,
    `${LEARNER}/components`,
    `${LEARNER}/lib`,
    `${OPS}/app`,
    `${OPS}/components`,
    `${OPS}/lib`,
    `${WORKER}/src`,
    ...packageSourceRoots(),
  ],

  /** Rule 1: the only directory that may reach a model provider. */
  gateway: GATEWAY,
  voice: VOICE,
  /** Everything under these is held to the "exactly these files open a connection" rule. */
  ai: [GATEWAY, PROMPTS, `${LEARNER}/lib/ai`],
  /** The files inside the gateway that may open a connection. A fifth needs a deliberate edit here. */
  transports: [
    `${GATEWAY}/openrouter.ts`,
    `${GATEWAY}/openrouter-embeddings.ts`,
    `${GATEWAY}/langchain-model.ts`,
    `${VOICE}/openrouter.ts`,
    // Not a model call: the price list, for the pricing snapshot job.
    `${GATEWAY}/openrouter-models.ts`,
  ],
  /** Rule 2: the only file that may name a model. */
  registry: `${GATEWAY}/registry.ts`,
  ledger: `${GATEWAY}/ledger.ts`,
  voiceMock: `${VOICE}/mock.ts`,
  /** Rule 4: prompt text lives here and nowhere else. */
  prompts: PROMPTS,

  /** The pure layer: Zod schemas and rules, no I/O. */
  domain: "packages/domain/src",
  /** The only code that touches the database. */
  repositories: [
    "packages/db/src",
    `${WORKER}/src/ingestion/repository.ts`,
    `${GATEWAY}/repositories`,
    `${LEARNER}/lib/retrieval/repository.ts`,
    "packages/product-ops/src/repository.ts",
    "packages/product-ops/src/rows.ts",
  ],

  /** The only files that may read process.env. */
  processEnvReaders: [
    "packages/env/src/schema.ts",
    `${LEARNER}/lib/env/server.ts`,
    `${LEARNER}/lib/env/client.ts`,
    `${OPS}/lib/env/server.ts`,
    `${OPS}/lib/env/client.ts`,
    `${WORKER}/src/env.ts`,
  ],
  /** Module specifiers a Client Component must never import. */
  serverOnlyModules: [
    "@/lib/env/server",
    "@/lib/supabase/server-client",
    "server-only",
    "next/headers",
  ],

  /** Each Next.js app: has a proxy.ts, has no middleware.ts. */
  nextApps: [LEARNER, OPS],
  /** Where "use server" modules may live. */
  serverActionRoots: [
    `${LEARNER}/app`,
    `${LEARNER}/lib`,
    `${LEARNER}/components`,
    `${OPS}/app`,
    `${OPS}/lib`,
    `${OPS}/components`,
  ],
  /** Committed environment templates, one per deployable. */
  envExamples: [`${LEARNER}/.env.example`, `${OPS}/.env.example`, `${WORKER}/.env.example`],

  migrations: "packages/db/supabase/migrations",
} as const;

export interface SourceFile {
  /** Repository-relative, forward slashes. */
  readonly path: string;
  readonly source: string;
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function absolute(repoRelative: string): string {
  return join(REPO_ROOT, ...repoRelative.split("/"));
}

/** Whether a repository-relative path is `root` or lives under it. */
export function under(path: string, root: string): boolean {
  return path === root || path.startsWith(root + "/");
}

export function sourceFiles(roots: readonly string[] = ROOTS.source): SourceFile[] {
  const found: SourceFile[] = [];

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        found.push({
          path: toPosix(relative(REPO_ROOT, full)),
          source: readFileSync(full, "utf8"),
        });
      }
    }
  };

  for (const root of roots) walk(absolute(root));
  return found;
}

/** Migration file names, sorted, so ordering assertions are deterministic. */
export function migrationFiles(): string[] {
  return readdirSync(absolute(ROOTS.migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Every migration, concatenated in order. */
export function migrationSql(): string {
  return migrationFiles()
    .map((name) => readFileSync(join(absolute(ROOTS.migrations), name), "utf8"))
    .join("\n");
}
