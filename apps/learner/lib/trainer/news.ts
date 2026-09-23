import type { CEFRLevel } from "@dp/domain/cefr";

/**
 * Turning a news page into something a beginner can be asked about.
 *
 * nachrichtenleicht.de writes in deliberately simple German, but "simple" is
 * one level, and the learner is at whichever one they are at: an A1 reader
 * three weeks in does not want the same sentence as a B1 reader, and handing
 * them one is how a reading exercise becomes a wall.
 *
 * So two things happen here, both arithmetic and neither a model's job: the
 * headlines are ordered so the shortest come first, and each level gets a
 * word budget for the retelling. The rewriting itself is the tutor's — that
 * is a language task — but what counts as "at this level" is decided here,
 * where it can be read and tested.
 */

/**
 * Words per sentence when the news is retold, by level.
 *
 * Sentence length is the load a beginner actually feels — long before rare
 * vocabulary, it is the clause they lose their place in. The A1 budget is a
 * short spoken sentence; B1 is comfortably a written one.
 */
export const NEWS_RETELL_WORDS: Readonly<Record<CEFRLevel, number>> = {
  A1: 6,
  A2: 9,
  B1: 14,
};

/** How many headlines the trainer gets to choose from. Enough to skip one. */
export const NEWS_CHOICES = 5;

/** The handful of entities the headlines actually use. */
function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&nbsp;", " ");
}

/**
 * The headlines on the page, in the order it printed them.
 *
 * A scrape, and treated as one: whatever comes out is third-party text on its
 * way into a fence, never markup to be trusted or instructions to be read.
 */
export function parseHeadlines(page: string): readonly string[] {
  return [
    ...page.matchAll(/<span class="headline-title">([^<]{4,200})<\/span>/g),
  ]
    .map((match) => decodeEntities(match[1]!.trim()))
    .filter((headline, index, all) => all.indexOf(headline) === index);
}

const words = (headline: string) =>
  headline.split(/\s+/u).filter((word) => word.length > 0).length;

/**
 * Shortest first, so the first item offered is the one to reach for.
 *
 * Ties break on character length and then alphabetically, because a session
 * that offers a different lead item on every call is a session that cannot be
 * reasoned about — the same news, twice, is the same exercise.
 */
export function simplestFirst(
  headlines: readonly string[],
  limit = NEWS_CHOICES,
): readonly string[] {
  return [...headlines]
    .sort(
      (a, b) => words(a) - words(b) || a.length - b.length || a.localeCompare(b),
    )
    .slice(0, limit);
}
