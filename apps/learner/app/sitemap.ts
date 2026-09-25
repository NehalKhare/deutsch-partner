import type { MetadataRoute } from "next";

import { siteEnv } from "@/lib/env/server";
import { absoluteUrl, PUBLIC_PAGES } from "@/lib/seo/site";

/** Read per request: the origin and the indexing switch are the deployment's, not the build's. */
export const dynamic = "force-dynamic";

/**
 * /sitemap.xml: the public pages and nothing else. No lastModified, because
 * a timestamp that changes on every request would tell a crawler the page
 * changes on every request, which is the opposite of the truth.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteEnv();
  if (!site.indexing) return [];

  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(site.appUrl, page.path),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
