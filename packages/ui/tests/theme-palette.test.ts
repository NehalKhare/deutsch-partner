import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Relative to the package, not to this module: the jsdom environment does not
// give `import.meta.url` a file: URL, and each workspace runs its own vitest.
const css = readFileSync(resolve(process.cwd(), "src/theme.css"), "utf8");

/**
 * The two palettes, held level.
 *
 * A theme fails in the least visible way possible: somebody adds a token to
 * the dark palette, uses it, and the light theme inherits a colour meant for a
 * near-black ground. Nothing throws and no test fails — the page is simply
 * wrong for the half of readers who never see it. So the rule is stated here
 * instead: every token exists in both palettes, and every token is assigned on
 * both of the paths that can turn the light theme on.
 */

function tokensMatching(pattern: RegExp): string[] {
  return [...css.matchAll(pattern)].map((match) => match[1]!).sort();
}

/** The `--light-*` block is one of the two roots; find its assignments. */
function assignmentsIn(block: string): string[] {
  return [...block.matchAll(/^\s*--([a-z-]+):\s*var\(--light-[a-z-]+\);$/gm)]
    .map((match) => match[1]!)
    .sort();
}

describe("the dark and light palettes", () => {
  it("define exactly the same set of tokens", () => {
    const dark = tokensMatching(/--dark-([a-z-]+):\s*#/g);
    const light = tokensMatching(/--light-([a-z-]+):\s*#/g);

    expect(light).toEqual(dark);
    expect(dark.length).toBeGreaterThan(10);
  });

  it("states every colour as a literal, so neither theme borrows the other's", () => {
    // A `--light-x: var(--dark-x)` would pass the check above while leaving
    // the light theme wearing a colour chosen for a near-black ground.
    expect(css).not.toMatch(/--light-[a-z-]+:\s*var\(--dark-/);
    expect(css).not.toMatch(/--dark-[a-z-]+:\s*var\(--light-/);
  });
});

describe("turning the light theme on", () => {
  /**
   * Two paths, because they answer different questions: the media query is
   * for a reader who has told their OS and never touches the toggle — it has
   * to work with JavaScript switched off — and the attribute is for a reader
   * who wants to differ from their OS.
   */
  const mediaBlock = css.match(
    /@media \(prefers-color-scheme: light\) \{[\s\S]*?\n\}/,
  )?.[0];
  const attributeBlock = css.match(
    /:root\[data-theme="light"\] \{[\s\S]*?\n\}/,
  )?.[0];

  it("has both a media-query path and an explicit-override path", () => {
    expect(mediaBlock).toBeTruthy();
    expect(attributeBlock).toBeTruthy();
  });

  it("lets an explicit dark choice out of the media query", () => {
    // Without the :not(), a reader who chose dark on a light OS gets light.
    expect(mediaBlock).toContain(':root:not([data-theme="dark"])');
  });

  it("assigns the same tokens on both paths", () => {
    expect(assignmentsIn(attributeBlock!)).toEqual(assignmentsIn(mediaBlock!));
  });

  it("assigns every token the light palette defines", () => {
    const defined = tokensMatching(/--light-([a-z-]+):\s*#/g);

    expect(assignmentsIn(attributeBlock!)).toEqual(defined);
  });

  it("sets color-scheme on both paths, so native controls follow too", () => {
    expect(mediaBlock).toContain("color-scheme: light");
    expect(attributeBlock).toContain("color-scheme: light");
  });
});

describe("the utilities the product actually writes", () => {
  it("names a role rather than a material, so a class can mean both themes", () => {
    // `bg-ink` cannot be honest on a near-white page; `bg-ground` can.
    for (const gone of ["--color-ink", "--color-dusk", "--color-haze", "--color-chalk"]) {
      expect(css).not.toContain(gone);
    }
    for (const role of ["--color-ground", "--color-panel", "--color-edge", "--color-copy"]) {
      expect(css).toContain(role);
    }
  });
});
