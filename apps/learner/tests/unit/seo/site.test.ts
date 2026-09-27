import { describe, expect, it } from "vitest";

import { LOGIN_PATH, PROTECTED_PREFIXES, SIGN_UP_PATH } from "@/lib/auth/routes";
import { absoluteUrl, PRIVATE_PATHS, PUBLIC_PAGES, publicPage, SITE } from "@/lib/seo/site";

/**
 * The site as a crawler meets it: three public pages, one identity, and a
 * list of places to stay out of that agrees with the list the proxy guards.
 */

describe("the public pages", () => {
  it("are the landing page, the prices and the two ways in, and nothing behind sign-in", () => {
    expect(PUBLIC_PAGES.map((page) => page.path)).toEqual(["/", "/pricing", SIGN_UP_PATH, LOGIN_PATH]);
  });

  it("rank the prices just below the landing page: it is the second question a visitor asks", () => {
    expect(publicPage("/pricing").priority).toBeLessThan(publicPage("/").priority);
    expect(publicPage("/pricing").priority).toBeGreaterThanOrEqual(publicPage(SIGN_UP_PATH).priority);
  });

  it("never overlap the private paths", () => {
    for (const page of PUBLIC_PAGES) {
      for (const prefix of PRIVATE_PATHS) {
        expect(page.path.startsWith(prefix), `${page.path} under ${prefix}`).toBe(false);
      }
    }
  });

  it("rank the landing page first and sign-in last", () => {
    expect(publicPage("/").priority).toBe(1);
    expect(publicPage(LOGIN_PATH).priority).toBeLessThan(publicPage(SIGN_UP_PATH).priority);
  });

  it("each say something different, because two identical descriptions are one listing", () => {
    const descriptions = new Set(PUBLIC_PAGES.map((page) => page.description));
    expect(descriptions.size).toBe(PUBLIC_PAGES.length);
  });

  it("refuse a path that is not public, so a private page cannot be given a canonical", () => {
    expect(() => publicPage("/dashboard")).toThrow(/not a public page/);
  });
});

describe("the private paths", () => {
  it("cover every prefix the proxy guards, so nothing guarded is ever crawled", () => {
    for (const prefix of PROTECTED_PREFIXES) {
      expect(PRIVATE_PATHS).toContain(prefix);
    }
  });

  it("cover the route handlers", () => {
    expect(PRIVATE_PATHS).toContain("/api");
  });

  it("cover a learner's plan and orders", () => {
    expect(PRIVATE_PATHS).toContain("/billing");
  });
});

describe("the identity", () => {
  it("describes the product in one sentence short enough for a search result", () => {
    // Google shows about 160 characters; a longer one is cut mid-word.
    expect(SITE.description.length).toBeLessThanOrEqual(160);
    expect(SITE.description).toMatch(/German/);
  });

  it("is written in English and says so", () => {
    expect(SITE.language).toBe("en");
  });
});

describe("absoluteUrl", () => {
  it("joins a path to the origin", () => {
    expect(absoluteUrl("https://deutschpartner.example", "/auth/sign-up")).toBe(
      "https://deutschpartner.example/auth/sign-up",
    );
  });

  it("does not care whether the base carries a trailing slash", () => {
    expect(absoluteUrl("https://a.example/", "/x")).toBe(absoluteUrl("https://a.example", "/x"));
  });

  it("resolves the root to the origin", () => {
    expect(absoluteUrl("https://a.example", "/")).toBe("https://a.example/");
  });
});
