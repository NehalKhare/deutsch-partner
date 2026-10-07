import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { STORAGE_KEYS } from "@/lib/legal/storage";

/**
 * The privacy policy's storage table is held to the code: every key the
 * learner app or the shared UI writes under the product's prefix must be
 * described, and nothing described may have stopped existing.
 */

const ROOTS = ["app", "components", "lib", "../../packages/ui/src"].map((dir) => join(process.cwd(), dir));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(readFileSync(full, "utf8"));
  }
  return out;
}

const keysInCode = new Set(
  ROOTS.flatMap(sources).flatMap((source) => [...source.matchAll(/["'](deutsch-partner\.[a-z0-9-]+)["']/g)].map((m) => m[1]!)),
);

describe("what the privacy policy says is stored in the browser", () => {
  it("covers every key the code writes", () => {
    const undocumented = [...keysInCode].filter((key) => !STORAGE_KEYS.includes(key));

    expect(undocumented).toEqual([]);
  });

  it("names nothing the code no longer writes", () => {
    const stale = STORAGE_KEYS.filter((key) => key.startsWith("deutsch-partner.") && !keysInCode.has(key));

    expect(stale).toEqual([]);
  });

  it("finds the keys at all, so an empty match is not a pass", () => {
    expect(keysInCode.size).toBeGreaterThan(0);
  });
});
