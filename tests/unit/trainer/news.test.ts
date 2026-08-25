import { describe, expect, it } from "vitest";

import {
  NEWS_RETELL_WORDS,
  parseHeadlines,
  simplestFirst,
} from "@/lib/trainer/news";

/**
 * Levelling the news.
 *
 * The scrape is one half — whatever the page prints, decoded and de-duplicated
 * — and the other half is the only editorial decision made without a model:
 * which item a beginner is offered first, and how much sentence they are
 * expected to take.
 */

const page = (...headlines: string[]) =>
  headlines
    .map((headline) => `<span class="headline-title">${headline}</span>`)
    .join("\n");

describe("reading the page", () => {
  it("takes the headlines and decodes what the page escaped", () => {
    expect(
      parseHeadlines(page("Regen &amp; Sonne im Norden", "Ein &quot;Fest&quot;")),
    ).toEqual(['Regen & Sonne im Norden', 'Ein "Fest"']);
  });

  it("says the same headline once", () => {
    expect(parseHeadlines(page("Ein Zug fällt aus", "Ein Zug fällt aus"))).toEqual([
      "Ein Zug fällt aus",
    ]);
  });

  it("finds nothing in a page that is not that page", () => {
    expect(parseHeadlines("<h1>Willkommen</h1>")).toEqual([]);
  });
});

describe("what a beginner is offered first", () => {
  it("puts the shortest headline first, whatever order the page used", () => {
    const ordered = simplestFirst([
      "Die Regierung berät heute über den Haushalt für das kommende Jahr",
      "Es regnet",
      "Der Zug nach Berlin fällt aus",
    ]);

    expect(ordered[0]).toBe("Es regnet");
    expect(ordered[1]).toBe("Der Zug nach Berlin fällt aus");
  });

  it("offers the same order twice, so the same news is the same exercise", () => {
    const headlines = ["Ein Tor", "Ein Sieg", "Zwei Tore fallen"];

    expect(simplestFirst(headlines)).toEqual(simplestFirst(headlines));
  });

  it("hands over a handful, not the whole page", () => {
    const many = Array.from({ length: 20 }, (_unused, index) => `Meldung ${index}`);

    expect(simplestFirst(many)).toHaveLength(5);
    expect(simplestFirst(many, 2)).toHaveLength(2);
  });
});

describe("how much sentence each level gets", () => {
  it("gives a beginner less of it than a B1 reader", () => {
    // The whole point: an A1 learner meeting a B1 sentence is a learner who
    // stops reading.
    expect(NEWS_RETELL_WORDS.A1).toBeLessThan(NEWS_RETELL_WORDS.A2);
    expect(NEWS_RETELL_WORDS.A2).toBeLessThan(NEWS_RETELL_WORDS.B1);
  });

  it("keeps the beginner's budget to a spoken sentence", () => {
    expect(NEWS_RETELL_WORDS.A1).toBeLessThanOrEqual(8);
  });
});
