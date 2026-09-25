import type { Metadata, Viewport } from "next";

import { LEARNER_PALETTE } from "@dp/ui/palette";

import type { SiteEnv } from "@/lib/env/server";
import { publicPage, SITE } from "@/lib/seo/site";

/**
 * What goes in the head, built from the site identity and the deployment.
 *
 * Pure functions of their inputs so the head can be asserted without a
 * request: what a search engine sees on the landing page is a claim, and a
 * claim is something a test should be able to read.
 */

const OG_IMAGE_ALT = `${SITE.name} — ${SITE.tagline}`;

/**
 * The share-card fields, whole.
 *
 * Next merges metadata shallowly: a page that sets `openGraph.title` replaces
 * the root's entire `openGraph`, and with it the site name, the locale and
 * the card type. So a page never sets part of either object; it sets all of
 * it, through these two.
 */
function openGraphFor(title: string, description: string, url: string): Metadata["openGraph"] {
  return { type: "website", siteName: SITE.name, locale: SITE.locale, title, description, url };
}

function twitterFor(title: string, description: string): Metadata["twitter"] {
  return { card: "summary_large_image", title, description };
}

/** The root: everything below inherits it and overrides only what it must. */
export function rootMetadata(site: SiteEnv): Metadata {
  const title = `${SITE.name} — ${SITE.tagline}`;
  return {
    metadataBase: new URL(site.appUrl),
    applicationName: SITE.name,
    title: { default: title, template: `%s — ${SITE.name}` },
    description: SITE.description,
    keywords: [...SITE.keywords],
    category: "education",
    // Never the full URL to a third party: a learner's thread id is in the
    // path, and it is theirs.
    referrer: "strict-origin-when-cross-origin",
    formatDetection: { telephone: false },
    openGraph: openGraphFor(title, SITE.description, "/"),
    twitter: twitterFor(title, SITE.description),
    robots: robotsFor(site.indexing),
    ...verificationFor(site),
  };
}

/**
 * A public page: its own title and description, and a canonical URL so the
 * same page reached with a tracking parameter is not a second page.
 */
export function publicPageMetadata(path: string): Metadata {
  const page = publicPage(path);
  return {
    title: path === "/" ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: openGraphFor(page.title, page.description, page.path),
    twitter: twitterFor(page.title, page.description),
  };
}

/**
 * A private page: never indexed, whatever the deployment says. A crawler that
 * lands on one is redirected to sign-in, and a redirected URL is still a URL
 * that can be listed.
 */
export const PRIVATE_PAGE_METADATA: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Two theme colours, one per scheme, so the browser chrome follows the page
 * the way the page follows the OS. `color-scheme` rides along for the space
 * beyond the page and the form controls.
 */
export const rootViewport: Viewport = {
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: LEARNER_PALETTE.dark.ground },
    { media: "(prefers-color-scheme: light)", color: LEARNER_PALETTE.light.ground },
  ],
};

export { OG_IMAGE_ALT };

function robotsFor(indexing: boolean): Metadata["robots"] {
  if (!indexing) return { index: false, follow: false };
  return {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  };
}

/** The search-console tags, only when a token is set: an empty tag is noise. */
function verificationFor(site: SiteEnv): Pick<Metadata, "verification"> {
  const { google, bing } = site.verification;
  if (!google && !bing) return {};
  return {
    verification: {
      ...(google ? { google } : {}),
      ...(bing ? { other: { "msvalidate.01": bing } } : {}),
    },
  };
}
