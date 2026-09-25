import type { MetadataRoute } from "next";

/**
 * /robots.txt for the operator app: nobody, nowhere. The app is a sign-in
 * form in front of a product's internals, and neither should ever appear in
 * a search result or an answer.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
