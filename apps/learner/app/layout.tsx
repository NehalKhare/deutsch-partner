import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@dp/ui/theme-script";
import { cn } from "@dp/ui/utils";

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

export const metadata: Metadata = {
  title: "Deutsch Partner — talk German from day one",
  description:
    "An AI conversation partner that speaks German you can follow, remembers what you keep getting wrong, and grows with you from your first word to B1.",
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
      <body className="flex min-h-full flex-col bg-ground text-copy">
        {children}
      </body>
    </html>
  );
}
