import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { isDeniedPath } from "@dp/domain/product-ops";
import type { RepositoryBrowser } from "./agents/tools";

/**
 * A read-only view of a repository checkout, for the planner.
 *
 * The planner reads; it never writes, so it needs no worktree, no git and no
 * command runner — only a directory that holds the repository. In development
 * that is the server's own working directory, which is how the plan can be
 * produced in the pipeline rather than deferred to a CLI worker.
 *
 * Three bounds, all here rather than in the tools that call this: the walk is
 * capped, a read is resolved inside the root and refused if it leaves it, and
 * a search is an in-process scan for an exact text rather than a grep, so no
 * argument of the model's choosing is ever passed to a process. The deny-list
 * is applied on top of the tools' own application of it: a planner never
 * reads a secret.
 */

/** How many paths a listing may hold. Enough to orient, not a whole tree. */
export const MAX_TREE_PATHS = 400;

/** How many files one search may open. */
export const MAX_SEARCHED_FILES = 300;

/** How many lines one search returns. */
export const MAX_SEARCH_HITS = 50;

/** Directories that are not this repository's source. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".ai",
  "coverage",
  "dist",
  "build",
  "test-results",
  "playwright-report",
]);

const SOURCE_FILE = /\.(ts|tsx|sql|md|json|css)$/u;

async function walk(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && found.length < MAX_TREE_PATHS) {
    const directory = queue.shift();
    if (directory === undefined) break;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (found.length >= MAX_TREE_PATHS) break;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;

      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) queue.push(full);
        continue;
      }
      if (!SOURCE_FILE.test(entry.name)) continue;

      found.push(relative(root, full).split(sep).join("/"));
    }
  }

  return found.sort();
}

/** Reads a file inside the root, or null. Resolved, so a symlink out is refused. */
async function readInside(root: string, path: string): Promise<string | null> {
  try {
    const realRoot = await realpath(root);
    const absolute = resolve(realRoot, path);
    if (absolute !== realRoot && !absolute.startsWith(realRoot + sep)) return null;

    const real = await realpath(absolute);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;

    return await readFile(real, "utf8");
  } catch {
    return null;
  }
}

export function createLocalRepositoryBrowser(options: {
  readonly root: string;
  /** Test seam. The real one walks the directory. */
  readonly tree?: () => Promise<readonly string[]>;
}): RepositoryBrowser {
  const tree = options.tree ?? (() => walk(options.root));

  return {
    async list(prefix) {
      const paths = await tree();
      const wanted = prefix.length === 0 ? "" : `${prefix}/`;

      return paths.filter(
        (path) => !isDeniedPath(path) && (wanted === "" || path.startsWith(wanted)),
      );
    },

    async read(path) {
      if (isDeniedPath(path)) return null;
      return readInside(options.root, path);
    },

    async search(text) {
      const hits: { path: string; line: number; text: string }[] = [];
      const paths = (await tree()).filter((path) => !isDeniedPath(path));

      for (const path of paths.slice(0, MAX_SEARCHED_FILES)) {
        if (hits.length >= MAX_SEARCH_HITS) break;
        const content = await readInside(options.root, path);
        if (content === null || !content.includes(text)) continue;

        for (const [index, line] of content.split("\n").entries()) {
          if (!line.includes(text)) continue;
          hits.push({ path, line: index + 1, text: line.trim().slice(0, 200) });
          if (hits.length >= MAX_SEARCH_HITS) break;
        }
      }

      return hits;
    },
  };
}
