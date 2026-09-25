import type { MetadataRoute } from "next";

import { LEARNER_PALETTE } from "@dp/ui/palette";

import { SITE } from "@/lib/seo/site";

/**
 * /manifest.webmanifest: what a phone needs to put the product on a home
 * screen. Dark is the base theme, so the splash and the chrome wear it; the
 * page itself follows the OS once it loads.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    lang: SITE.language,
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: LEARNER_PALETTE.dark.ground,
    theme_color: LEARNER_PALETTE.dark.ground,
    categories: ["education"],
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
