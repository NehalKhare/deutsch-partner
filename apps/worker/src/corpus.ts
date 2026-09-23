import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Where the hand-authored corpus lives.
 *
 * Resolved through the workspace package rather than from the working
 * directory, so it is found the same way on a laptop and in a pruned
 * container image.
 */
export function corpusRoot(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve("@dp/corpus/package.json"));
}

export function corpusContentDir(): string {
  return join(corpusRoot(), "content");
}
