import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LEARNER_PALETTE, type PaletteRole } from "../src/palette";

// Relative to the package, as theme-palette.test.ts explains.
const css = readFileSync(resolve(process.cwd(), "src/theme.css"), "utf8");

/**
 * The TypeScript copy of the palette, held equal to the CSS.
 *
 * The manifest and the Open Graph card cannot read a stylesheet, so they read
 * palette.ts instead. A retuned theme that forgets this file would ship a
 * share card in last season's colours, and nothing on screen would show it.
 */

/** palette.ts spells the role in camelCase; the CSS custom property in kebab. */
const CSS_NAME: Record<PaletteRole, string> = {
  ground: "ground",
  panel: "panel",
  edge: "edge",
  copy: "copy",
  brand: "brand",
  onAccent: "on-accent",
};

function literalIn(theme: "dark" | "light", role: PaletteRole): string | undefined {
  return css.match(new RegExp(`--${theme}-${CSS_NAME[role]}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
}

describe.each(["dark", "light"] as const)("the %s palette in palette.ts", (theme) => {
  it.each(Object.keys(LEARNER_PALETTE[theme]) as PaletteRole[])(
    "states %s exactly as theme.css does",
    (role) => {
      expect(literalIn(theme, role)).toBe(LEARNER_PALETTE[theme][role]);
    },
  );
});
