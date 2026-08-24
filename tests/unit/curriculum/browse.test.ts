import { describe, expect, it } from "vitest";

import { CEFR_LEVELS, MAX_MINI_LEVEL, miniLevelRangeFor } from "@/domain/cefr";
import { ARTICLES, browseBand, levelToBrowse } from "@/lib/curriculum/browse";
import { VOCABULARY_CATALOGUE } from "@/learning/vocabulary-catalogue";

/**
 * The syllabus as a learner reads it.
 *
 * All of this data already existed and none of it was reachable. The tests
 * that matter are about completeness: a word list a learner cannot trust to be
 * the whole level is a word list they will not revise from.
 */

describe("what a band shows", () => {
  it.each(CEFR_LEVELS)("covers exactly the mini-levels %s spans", (level) => {
    const band = browseBand(level);
    const { first, last } = miniLevelRangeFor(level);

    expect(band.levels).toHaveLength(last - first + 1);
    expect(band.levels[0]?.miniLevel).toBe(first);
    expect(band.levels.at(-1)?.miniLevel).toBe(last);
  });

  it("leaves no mini-level unreachable across the three bands", () => {
    const shown = CEFR_LEVELS.flatMap((level) =>
      browseBand(level).levels.map((entry) => entry.miniLevel),
    );

    expect(new Set(shown).size).toBe(MAX_MINI_LEVEL);
  });

  it("shows every word the curriculum teaches, and no others", () => {
    const shown = CEFR_LEVELS.flatMap((level) =>
      browseBand(level).levels.flatMap((entry) => entry.words.map((w) => w.word)),
    );

    expect(shown).toHaveLength(VOCABULARY_CATALOGUE.length);
  });

  it("gives every word its English, because a word list without one is a puzzle", () => {
    for (const level of CEFR_LEVELS) {
      for (const entry of browseBand(level).levels) {
        for (const word of entry.words) {
          expect(
            word.english.length,
            `${word.word} has no translation`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps the article on the word, where a learner has to learn it", () => {
    // "Bahnhof" is a word to look up. "der Bahnhof" is the thing to remember.
    const nouns = browseBand("A1")
      .levels.flatMap((entry) => entry.words)
      .filter((word) => word.article !== null);

    expect(nouns.length).toBeGreaterThan(0);
    for (const noun of nouns) {
      expect(noun.word.toLowerCase()).toContain(noun.article as string);
    }
  });

  it("names grammar in words rather than in slugs", () => {
    const grammar = browseBand("A1").levels.flatMap((entry) => entry.grammar);

    expect(grammar.length).toBeGreaterThan(0);
    for (const label of grammar) {
      expect(label, `${label} looks like a slug`).not.toMatch(/_/);
    }
  });

  it("keeps the levels in the order a learner would work through them", () => {
    const order = browseBand("A2").levels.map((entry) => entry.miniLevel);

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("der, die, das", () => {
  it("groups every noun in the band under its own article", () => {
    const band = browseBand("A1");
    const grouped = band.byArticle.flatMap((group) => group.words);

    expect(grouped).toHaveLength(band.nounCount);
    for (const group of band.byArticle) {
      for (const word of group.words) {
        expect(word.article).toBe(group.article);
      }
    }
  });

  it("offers all three articles even where a band has few of one", () => {
    // Three columns is the practice. Dropping a thin one would quietly change
    // what the page teaches.
    expect(browseBand("A1").byArticle.map((group) => group.article)).toEqual(
      ARTICLES,
    );
  });

  it("leaves words that have no article out of the article practice", () => {
    const band = browseBand("A1");

    expect(band.nounCount).toBeLessThan(band.wordCount);
    for (const group of band.byArticle) {
      for (const word of group.words) expect(word.article).not.toBeNull();
    }
  });

  it("sorts each article group so a learner can find a word in it", () => {
    const words = browseBand("A2").byArticle[0]?.words.map((w) => w.word) ?? [];

    expect(words.length).toBeGreaterThan(0);
    expect(words).toEqual([...words].sort((a, b) => a.localeCompare(b, "de")));
  });

  it("counts what it actually shows", () => {
    const band = browseBand("B1");

    expect(band.wordCount).toBe(
      band.levels.reduce((total, entry) => total + entry.words.length, 0),
    );
    expect(band.nounCount).toBe(
      band.byArticle.reduce((total, group) => total + group.words.length, 0),
    );
  });

  it("finds nouns of every article somewhere in the syllabus", () => {
    const totals = ARTICLES.map((article) =>
      CEFR_LEVELS.reduce(
        (total, level) =>
          total +
          (browseBand(level).byArticle.find((g) => g.article === article)?.words
            .length ?? 0),
        0,
      ),
    );

    for (const total of totals) expect(total).toBeGreaterThan(0);
  });
});

describe("which band to show", () => {
  it.each(CEFR_LEVELS)("shows %s when it was asked for", (level) => {
    expect(levelToBrowse(level, "A1")).toBe(level);
  });

  it.each([undefined, null, "", "C1", "a1", 2, {}, ["A2"]])(
    "falls back to where the learner is for %j",
    (requested) => {
      // The level arrives in a URL, which a learner can type anything into.
      expect(levelToBrowse(requested, "A2")).toBe("A2");
    },
  );
});
