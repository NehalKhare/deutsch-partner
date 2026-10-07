import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { ROOTS, absolute, sourceFiles, under } from "../src/roots";

/**
 * Nothing in the learner's browser talks to a third party.
 *
 * The product has no cookie banner because it needs none: everything it
 * stores in a browser is strictly necessary (§25(2) TDDDG), and no script
 * from anyone else runs on its pages. That is only true until somebody adds
 * analytics, an error tracker, a font served from a CDN or a tag manager —
 * each of which would need consent, a banner and a line in the privacy
 * policy. This test makes the addition a deliberate act: a new third party
 * fails here, and the fix is to decide about consent, not to delete the
 * test.
 */

const learnerRoots = ROOTS.source.filter((root) => root.startsWith("apps/learner/"));
const files = sourceFiles(learnerRoots).filter((file) => !under(file.path, "apps/learner/lib/ai"));

const TRACKING_PACKAGES = [
  "@vercel/analytics",
  "@vercel/speed-insights",
  "posthog-js",
  "@sentry/nextjs",
  "@sentry/react",
  "react-ga",
  "react-ga4",
  "@next/third-parties",
  "mixpanel-browser",
  "@segment/analytics-next",
  "hotjar",
  "@hotjar/browser",
  "@usercentrics/cmp-browser-sdk",
  "react-cookie-consent",
  "vanilla-cookieconsent",
];

describe("the learner app loads nothing from a third party in the browser", () => {
  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("depends on no analytics, tracking or consent package", () => {
    const manifest = JSON.parse(readFileSync(absolute("apps/learner/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(declared.filter((name) => TRACKING_PACKAGES.includes(name))).toEqual([]);
  });

  it("embeds no script from another origin", () => {
    // next/script with an https source, or a raw <script src="https://…">.
    const offenders = files
      .filter((file) => /<[Ss]cript[^>]*\ssrc=["'{]?\s*["']?https?:\/\//.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("loads no stylesheet or font from a CDN", () => {
    // next/font/google downloads at build time and serves from this origin;
    // a <link> to the Google Fonts CDN would send every visitor's IP to Google.
    const offenders = files
      .filter((file) => /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("names no analytics or tag-manager endpoint", () => {
    const offenders = files
      .filter((file) =>
        /googletagmanager\.com|google-analytics\.com|plausible\.io\/js|posthog\.com|sentry\.io|hotjar\.com|segment\.com|mixpanel\.com/.test(
          file.source,
        ),
      )
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});
