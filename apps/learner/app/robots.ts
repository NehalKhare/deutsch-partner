import type { MetadataRoute } from "next";

import { siteEnv } from "@/lib/env/server";
import { crawlPolicy } from "@/lib/seo/crawlers";
import { absoluteUrl } from "@/lib/seo/site";

/** Read per request: the origin and the indexing switch are the deployment's, not the build's. */
export const dynamic = "force-dynamic";

/**
 * /robots.txt. The policy is decided in lib/seo/crawlers.ts; this file only
 * hands it the deployment. A deployment that may not be indexed names no
 * sitemap, because a sitemap is an invitation.
 */
export default function robots(): MetadataRoute.Robots {
  const site = siteEnv();
  return {
    rules: crawlPolicy(site.indexing),
    ...(site.indexing ? { sitemap: absoluteUrl(site.appUrl, "/sitemap.xml") } : {}),
  };
}
