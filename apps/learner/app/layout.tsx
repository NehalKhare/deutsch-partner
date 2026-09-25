import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@dp/ui/theme-script";
import { cn } from "@dp/ui/utils";

import { siteEnv } from "@/lib/env/server";
import { rootMetadata, rootViewport } from "@/lib/seo/metadata";

/**
 * Rendered per request, never at build.
 *
 * The head carries absolute URLs — the canonical, the share card, the
 * sitemap — built from APP_URL, and `next build` runs in a container that has
 * no APP_URL: it would bake localhost into every canonical on the site. So
 * the origin is read when a request arrives, where the environment is the
 * deployment's own. The cost is a server render of the landing page per
 * visit, which the session refresh in proxy.ts was already paying for.
 */
export const dynamic = "force-dynamic";

/**
 * Two faces, chosen against each other: the companion is soft and round, so
 * the display face is tight and slightly odd rather than more of the same.
 * The body serif is deliberate too — this is a product about reading and
 * saying sentences, not a dashboard.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-display",
  display: "swap",
});

const body = Newsreader({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** The head every page inherits. What it says is decided in lib/seo/metadata.ts. */
export function generateMetadata(): Metadata {
  return rootMetadata(siteEnv());
}

/**
 * Edge to edge on a notched phone, so env(safe-area-inset-*) reports real
 * insets. The learner's tab bar pads itself clear of the home indicator with
 * them; without cover they are always zero. The theme colours ride along so
 * the browser chrome follows the page.
 */
export const viewport: Viewport = rootViewport;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        display.variable,
        body.variable,
        "font-body",
      )}
    >
      <head>
        {/* Before anything paints: see ThemeScript. */}
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col bg-ground text-copy">
        {children}
      </body>
    </html>
  );
}
