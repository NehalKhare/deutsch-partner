import { describe, expect, it } from "vitest";

import { LEARNER_PALETTE } from "@dp/ui/palette";

import type { SiteEnv } from "@/lib/env/server";
import {
  OG_IMAGE_ALT,
  PRIVATE_PAGE_METADATA,
  publicPageMetadata,
  rootMetadata,
  rootViewport,
} from "@/lib/seo/metadata";
import { SITE } from "@/lib/seo/site";

/**
 * The head, asserted. What a search engine reads on the landing page is a
 * claim about the product, and this is where the claim is pinned.
 */

const production: SiteEnv = {
  appUrl: "https://deutschpartner.example",
  indexing: true,
  verification: {},
};

const staging: SiteEnv = { ...production, indexing: false };

describe("the root metadata", () => {
  it("resolves every relative URL against APP_URL, never a request header", () => {
    expect(rootMetadata(production).metadataBase?.toString()).toBe("https://deutschpartner.example/");
  });

  it("gives every page the site's name through one template", () => {
    const title = rootMetadata(production).title;
    expect(title).toEqual({
      default: `${SITE.name} — ${SITE.tagline}`,
      template: `%s — ${SITE.name}`,
    });
  });

  it("describes the product the same way to Google, Facebook and X", () => {
    const meta = rootMetadata(production);
    expect(meta.description).toBe(SITE.description);
    expect(meta.openGraph?.description).toBe(SITE.description);
    expect(meta.twitter?.description).toBe(SITE.description);
  });

  it("names the site and its locale for a share card, and asks for the large card", () => {
    const meta = rootMetadata(production);
    expect(meta.openGraph).toMatchObject({ type: "website", siteName: SITE.name, locale: SITE.locale });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("invites indexing on a production deployment, with full previews", () => {
    expect(rootMetadata(production).robots).toMatchObject({
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    });
  });

  it("forbids indexing anywhere else", () => {
    expect(rootMetadata(staging).robots).toEqual({ index: false, follow: false });
  });

  it("does not hand a learner's thread id to a third party in the referrer", () => {
    expect(rootMetadata(production).referrer).toBe("strict-origin-when-cross-origin");
  });

  it("prints no verification tag until a token is set", () => {
    expect(rootMetadata(production).verification).toBeUndefined();
  });

  it("prints the search-console tags when their tokens are set", () => {
    const meta = rootMetadata({
      ...production,
      verification: { google: "google-token", bing: "bing-token" },
    });
    expect(meta.verification).toEqual({
      google: "google-token",
      other: { "msvalidate.01": "bing-token" },
    });
  });

  it("prints only the token that is set", () => {
    const meta = rootMetadata({ ...production, verification: { google: "google-token" } });
    expect(meta.verification).toEqual({ google: "google-token" });
  });
});

describe("a public page", () => {
  it("carries a canonical URL, so a tracking parameter is not a second page", () => {
    expect(publicPageMetadata("/auth/sign-up").alternates).toEqual({ canonical: "/auth/sign-up" });
  });

  it("keeps the landing page's title whole rather than templated", () => {
    expect(publicPageMetadata("/").title).toEqual({ absolute: `${SITE.name} — ${SITE.tagline}` });
    expect(publicPageMetadata("/auth/login").title).toBe("Sign in");
  });

  it("says the same thing in the share card as in the search result", () => {
    const meta = publicPageMetadata("/auth/sign-up");
    expect(meta.openGraph?.description).toBe(meta.description);
    expect(meta.openGraph?.url).toBe("/auth/sign-up");
  });

  it("restates the whole share card, because Next replaces the root's rather than merging it", () => {
    // A page that set only openGraph.title would lose the site name, the
    // locale and the large card type on its way to the head. Playwright
    // found this one: the landing page shipped a "summary" card.
    const meta = publicPageMetadata("/");
    expect(meta.openGraph).toMatchObject({ type: "website", siteName: SITE.name, locale: SITE.locale });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });
});

describe("a private page", () => {
  it("is never indexed, whatever the deployment says", () => {
    expect(PRIVATE_PAGE_METADATA.robots).toEqual({ index: false, follow: false });
  });

  it("carries no canonical, because it has no public address", () => {
    expect(PRIVATE_PAGE_METADATA.alternates).toBeUndefined();
  });
});

describe("the viewport", () => {
  it("keeps the notched-phone insets the tab bar depends on", () => {
    expect(rootViewport.viewportFit).toBe("cover");
  });

  it("colours the browser chrome from the same palette as the page, one per scheme", () => {
    expect(rootViewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: dark)", color: LEARNER_PALETTE.dark.ground },
      { media: "(prefers-color-scheme: light)", color: LEARNER_PALETTE.light.ground },
    ]);
  });
});

describe("the share card's alt text", () => {
  it("is the site's own title", () => {
    expect(OG_IMAGE_ALT).toBe(`${SITE.name} — ${SITE.tagline}`);
  });
});
