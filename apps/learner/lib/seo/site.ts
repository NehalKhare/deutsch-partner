import { LOGIN_PATH, SIGN_UP_PATH } from "@/lib/auth/routes";

export { PRIVATE_PATHS } from "@/lib/seo/private-paths";

/**
 * The site as a search engine or an answer engine meets it.
 *
 * One identity, stated once: the name, what it is in a sentence, and the
 * pages a visitor without an account can reach. Everything that faces
 * a crawler — the head of every page, robots.txt, the sitemap, the manifest,
 * the share card and llms.txt — reads from here, so the product cannot
 * describe itself one way to Google and another to a browser tab.
 */
export const SITE = {
  name: "Deutsch Partner",
  /** The half of the title that says what it is, in the register the page uses. */
  tagline: "Talk German from day one",
  description:
    "An AI conversation partner that speaks German you can follow, remembers what you keep getting wrong, and grows with you from your first word to B1.",
  /** The language the site is written in. The language it teaches is German. */
  language: "en",
  locale: "en_GB",
  keywords: [
    "learn German",
    "German conversation practice",
    "AI German tutor",
    "German for English speakers",
    "German A1",
    "German A2",
    "German B1",
    "speak German",
  ],
} as const;

export interface PublicPage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** Relative importance within this site, as the sitemap protocol states it. */
  readonly priority: number;
  readonly changeFrequency: "weekly" | "monthly" | "yearly";
}

/**
 * The pages that exist for a visitor without an account. Only these go in
 * the sitemap, only these carry a canonical URL, and nothing else is
 * described to a crawler at all.
 */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: "/",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    priority: 1,
    changeFrequency: "weekly",
  },
  {
    path: "/pricing",
    title: "Plans and prices",
    description:
      "Free, Plus and Premium, monthly or yearly, or a one-off pass. Prices include VAT, Free never asks for a card, and no plan changes how you are assessed.",
    priority: 0.9,
    changeFrequency: "weekly",
  },
  {
    path: SIGN_UP_PATH,
    title: "Create an account",
    description:
      "Start learning German in conversation. Free to start, no card, and your first conversation takes about two minutes.",
    priority: 0.8,
    changeFrequency: "monthly",
  },
  {
    path: LOGIN_PATH,
    title: "Sign in",
    description: "Sign in to Deutsch Partner and carry on where you left off.",
    priority: 0.3,
    changeFrequency: "yearly",
  },
];

export function publicPage(path: string): PublicPage {
  const page = PUBLIC_PAGES.find((candidate) => candidate.path === path);
  if (!page) throw new Error(`${path} is not a public page`);
  return page;
}

/**
 * An absolute URL on this site.
 *
 * Built with the URL class rather than by concatenation, so a base with or
 * without a trailing slash yields the same address. The base is APP_URL, never
 * the request's Host header: a canonical taken from a header is a canonical
 * an attacker can set.
 */
export function absoluteUrl(base: string, path: string): string {
  return new URL(path, base).toString();
}
