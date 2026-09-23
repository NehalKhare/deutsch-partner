import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Relative to the package, not to this module: the jsdom environment does not
// give `import.meta.url` a file: URL, and each workspace runs its own vitest.
const read = (name: string) =>
  readFileSync(resolve(process.cwd(), "src", name), "utf8");

const learner = read("theme.css");
const ops = read("theme-ops.css");

/**
 * The operator app's palette, held against the learner's.
 *
 * A second palette fails quietly. It overrides a value the first one defines,
 * so a typo does not throw and a missing token does not fail a build — the
 * operator app simply wears one of the learner's colours in the middle of an
 * Atlassian page, and only somebody looking at that screen would know. These
 * are the three ways it can go wrong, stated once.
 */

function constants(css: string, prefix: "dark" | "light"): string[] {
  return [...css.matchAll(new RegExp(`--${prefix}-([a-z-]+):\\s*#`, "g"))]
    .map((match) => match[1]!)
    .sort();
}

describe("the operator palette", () => {
  it("overrides the same tokens in both themes", () => {
    // A token replaced in dark but not light is a page that is Atlassian until
    // somebody's OS switches, and half warm afterwards.
    expect(constants(ops, "light")).toEqual(constants(ops, "dark"));
  });

  it("introduces no token the learner's theme does not already define", () => {
    // A name only this file knows is a name nothing reads: the role variables
    // and the `@theme` mapping are both in theme.css.
    const known = new Set(constants(learner, "dark"));

    for (const token of constants(ops, "dark")) expect(known).toContain(token);
  });

  it("states every value as a literal rather than borrowing the learner's", () => {
    expect(ops).not.toMatch(/--(?:dark|light)-[a-z-]+:\s*var\(/);
  });

  it("leaves the learner's own colours alone", () => {
    // The German gender colours and the Trainer invite's gradient. The
    // operator app renders none of them, and inheriting them is what says so.
    for (const token of ["der", "die", "das", "filament", "filament-deep"]) {
      expect(ops).not.toContain(`--dark-${token}:`);
      expect(ops).not.toContain(`--light-${token}:`);
    }
  });

  it("replaces every token the operator app can actually put on screen", () => {
    // Everything except the five above. Miss one and that single colour stays
    // warm on an otherwise blue page.
    const learnerOnly = new Set(["der", "die", "das", "filament", "filament-deep"]);
    const shared = constants(learner, "dark").filter((t) => !learnerOnly.has(t));

    expect(constants(ops, "dark")).toEqual(shared.sort());
  });
});

describe("where it sits in the cascade", () => {
  it("is imported after the theme it overrides", () => {
    // Both write plain `:root`, so equal specificity is settled by source
    // order: theme-ops.css last, or none of it applies.
    const globals = readFileSync(
      resolve(process.cwd(), "..", "..", "apps", "ops", "app", "globals.css"),
      "utf8",
    );

    expect(globals.indexOf("theme-ops.css")).toBeGreaterThan(
      globals.indexOf('@import "@dp/ui/theme.css"'),
    );
  });

  it("is not imported by the learner, which keeps its own palette", () => {
    const globals = readFileSync(
      resolve(process.cwd(), "..", "..", "apps", "learner", "app", "globals.css"),
      "utf8",
    );

    expect(globals).not.toContain("theme-ops");
  });
});

/**
 * The rule the dropdown broke.
 *
 * `panel` is a surface set *into* the page — a card, a stat tile. `raised` is
 * a layer floating *over* it — a menu, a popover. They were one token, so the
 * account menu wore `panel`, and on both light themes `panel` is darker than
 * the ground it floats over. The result reads as a hole cut in the rail rather
 * than as something lifted off it, and no test could have caught it because
 * the colour was, in every other sense, correct.
 */

function value(css: string, token: string): string | null {
  return css.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{3,8});`, "i"))?.[1] ?? null;
}

/** Relative luminance, WCAG's definition. */
function luminance(hex: string): number {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const channel = (pair: string) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(full.slice(1, 3));
  const g = channel(full.slice(3, 5));
  const b = channel(full.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("a floating layer is never darker than the page under it", () => {
  const palettes = [
    ["the learner's", learner],
    ["the operator's", ops],
  ] as const;

  for (const [name, css] of palettes) {
    for (const theme of ["dark", "light"] as const) {
      it(`holds in ${name} ${theme} theme`, () => {
        const ground = value(css, `${theme}-ground`);
        const raised = value(css, `${theme}-raised`);

        expect(ground).toBeTruthy();
        expect(raised).toBeTruthy();
        // Equal is allowed: a white menu on a white page is lifted by its
        // border and its shadow, which is how Atlassian draws one.
        expect(luminance(raised!)).toBeGreaterThanOrEqual(luminance(ground!));
      });
    }
  }
});
