import type { MetadataRoute } from "next";

import { PRIVATE_PATHS } from "@/lib/seo/private-paths";

/**
 * Who may crawl, and where.
 *
 * Search engines find the site; answer engines quote it. The second kind is
 * named one by one below, not because the policy differs from the general
 * rule but because leaving them to the wildcard would make the decision an
 * accident. It is deliberate: an answer engine that can read the public pages
 * can tell someone what the product is when they ask, and one that cannot
 * will answer from whatever a competitor wrote about it instead. The
 * private rooms stay out of reach for every agent, as they do for search.
 *
 * Answer engines and their crawlers, by the user-agent each publishes.
 */
export const ANSWER_ENGINE_AGENTS = [
  // OpenAI: training, search index, and a user's live browsing.
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic: the same three.
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  // Perplexity.
  "PerplexityBot",
  "Perplexity-User",
  // Google's and Apple's opt-in for generative use, separate from search.
  "Google-Extended",
  "Applebot-Extended",
  // Microsoft Copilot answers from Bing's index.
  "Bingbot",
  "DuckAssistBot",
  "meta-externalagent",
  "Amazonbot",
  "CCBot",
  "cohere-ai",
] as const;

/**
 * Content signals, as robots.txt now carries them: the site may be searched
 * and quoted in an answer. Whether it may be used for training is a
 * business decision that has not been taken, so it is not stated either way.
 */
export const CONTENT_SIGNAL = "search=yes, ai-input=yes";

type Rules = MetadataRoute.Robots["rules"];

/**
 * The robots.txt rules for a deployment.
 *
 * An unindexable deployment — staging, a preview, a local run — disallows
 * everything for everyone, which is the one rule every crawler honours. An
 * indexable one allows the public pages and keeps every agent out of the
 * rooms.
 */
export function crawlPolicy(indexing: boolean): Rules {
  if (!indexing) return [{ userAgent: "*", disallow: "/" }];

  const disallow = PRIVATE_PATHS.map((path) => `${path}/`).concat(PRIVATE_PATHS);
  return [
    { userAgent: "*", allow: "/", disallow, other: { "Content-Signal": CONTENT_SIGNAL } },
    { userAgent: [...ANSWER_ENGINE_AGENTS], allow: "/", disallow },
  ];
}
