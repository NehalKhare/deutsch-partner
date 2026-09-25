import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";
import robots from "@/app/robots";
import { config as proxyConfig } from "@/proxy";

/**
 * The operator app is never indexed, and says so three ways: robots.txt
 * turns every crawler away, every response carries the header, and the root
 * layout's noindex tag (held by the security tests) covers a bot that reads
 * neither.
 */

describe("/robots.txt", () => {
  it("turns every agent away from everything", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("names no sitemap, because there is nothing to invite anyone to", () => {
    expect(robots().sitemap).toBeUndefined();
  });

  it("is served without a session refresh", () => {
    const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);
    expect(matcher.test("/robots.txt")).toBe(false);
    expect(matcher.test("/costs")).toBe(true);
  });
});

describe("every response", () => {
  it("carries the header that keeps it out of an index and out of a cache", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ]);
  });
});
