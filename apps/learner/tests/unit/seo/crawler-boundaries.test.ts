import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";
import { config as proxyConfig } from "@/proxy";
import { PRIVATE_PATHS } from "@/lib/seo/site";

/**
 * The two places a crawler is handled before any page renders: the proxy,
 * which must not spend a session refresh on robots.txt, and the response
 * headers, which must tell a crawler to leave a private room even when it
 * ignores the page.
 */

/** Next's matcher is path-to-regexp syntax; this one is a plain regex in disguise. */
const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);

describe("the proxy matcher", () => {
  it.each([
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/llms.txt",
    "/opengraph-image",
    "/twitter-image",
    "/icon",
    "/apple-icon",
  ])("lets %s through without a session refresh", (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it.each(["/", "/dashboard", "/auth/login", "/chat/abc", "/iconography"])(
    "still refreshes the session on %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );
});

describe("the response headers", () => {
  it("tell a crawler to leave every private path, bare and nested", async () => {
    const rules = await nextConfig.headers!();
    const sources = rules.map((rule) => rule.source);

    for (const path of PRIVATE_PATHS) {
      const room = path.slice(1);
      const bare = sources.find((source) => !source.endsWith("/:path*") && source.includes(room));
      const nested = sources.find((source) => source.endsWith("/:path*") && source.includes(room));
      expect(bare, `${path} bare`).toBeDefined();
      expect(nested, `${path} nested`).toBeDefined();
    }

    for (const rule of rules) {
      expect(rule.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
    }
  });

  it("say nothing about the public pages, whose head speaks for them", async () => {
    const rules = await nextConfig.headers!();
    for (const rule of rules) {
      expect(rule.source).not.toBe("/:path*");
      expect(rule.source).not.toBe("/");
      expect(rule.source).not.toContain("auth");
    }
  });
});
