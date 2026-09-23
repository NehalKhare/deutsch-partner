import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@dp/ui/theme-script";
import { cn } from "@dp/ui/utils";

/** The same faces as the learner app, so the two products read as one house. */
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

export const metadata: Metadata = {
  title: "Deutsch Partner — operations",
  description: "Product ops and AI spend for Deutsch Partner. Operators only.",
  robots: { index: false, follow: false },
};

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
      <body className="flex min-h-full flex-col bg-ground text-copy">{children}</body>
    </html>
  );
}
