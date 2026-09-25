import { beforeEach, describe, expect, it, vi } from "vitest";

import { LEARNER_PALETTE } from "@dp/ui/palette";

import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { GET as llms } from "@/app/llms.txt/route";
import { PRIVATE_PATHS, PUBLIC_PAGES, SITE } from "@/lib/seo/site";

/**
 * The files a crawler asks for, rendered against a stubbed deployment. The
 * policy is tested in its own modules; here is only that each route hands
 * the deployment's origin and indexing switch through.
 */

const ORIGIN = "https://deutschpartner.example";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_URL", ORIGIN);
});

describe("/robots.txt", () => {
  it("names the sitemap by its absolute address on an indexable deployment", () => {
    vi.stubEnv("SEO_INDEXING", "true");

    expect(robots().sitemap).toBe(`${ORIGIN}/sitemap.xml`);
  });

  it("names no sitemap and allows nothing anywhere else", () => {
    vi.stubEnv("SEO_INDEXING", "false");

    const result = robots();
    expect(result.sitemap).toBeUndefined();
    expect(result.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });
});

describe("/sitemap.xml", () => {
  it("lists every public page by its absolute address, and nothing private", () => {
    vi.stubEnv("SEO_INDEXING", "true");

    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(PUBLIC_PAGES.map((page) => new URL(page.path, ORIGIN).toString()));
    for (const path of PRIVATE_PATHS) {
      expect(urls.some((url) => url.startsWith(`${ORIGIN}${path}`))).toBe(false);
    }
  });

  it("carries no timestamp, which would claim a change on every request", () => {
    vi.stubEnv("SEO_INDEXING", "true");

    for (const entry of sitemap()) {
      expect(entry.lastModified).toBeUndefined();
    }
  });

  it("is empty on a deployment that may not be indexed", () => {
    vi.stubEnv("SEO_INDEXING", "false");

    expect(sitemap()).toEqual([]);
  });
});

describe("/manifest.webmanifest", () => {
  it("names the product and starts at the landing page", () => {
    const result = manifest();
    expect(result.name).toBe(SITE.name);
    expect(result.start_url).toBe("/");
    expect(result.display).toBe("standalone");
  });

  it("wears the base theme's ground, read from the palette the CSS is held to", () => {
    const result = manifest();
    expect(result.theme_color).toBe(LEARNER_PALETTE.dark.ground);
    expect(result.background_color).toBe(LEARNER_PALETTE.dark.ground);
  });

  it("offers the generated icons alongside the favicon", () => {
    const sources = manifest().icons?.map((icon) => icon.src);
    expect(sources).toEqual(["/favicon.ico", "/icon", "/apple-icon"]);
  });
});

describe("/llms.txt", () => {
  it("is plain text, cacheable, and links the site by its origin", async () => {
    const response = llms();
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");

    const body = await response.text();
    expect(body.startsWith(`# ${SITE.name}`)).toBe(true);
    expect(body).toContain(`${ORIGIN}/auth/sign-up`);
  });
});
