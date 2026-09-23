import { describe, expect, it } from "vitest";

import { CURRICULUM_ENTRIES } from "../src/curriculum";
import { LEXICON } from "../src/lexicon";

const curriculumWords = CURRICULUM_ENTRIES.flatMap((entry) => entry.vocabulary);

describe("the lexicon", () => {
  it("defines every word the curriculum targets", () => {
    const defined = new Set(LEXICON.map((seed) => seed.word));
    const missing = curriculumWords.filter((word) => !defined.has(word));

    expect(missing).toEqual([]);
  });

  it("defines no word the curriculum never targets", () => {
    const targeted = new Set(curriculumWords);
    const orphans = LEXICON.filter((seed) => !targeted.has(seed.word));

    expect(orphans.map((seed) => seed.word)).toEqual([]);
  });

  it("introduces each word exactly once across the whole path", () => {
    // A target list introduces; the review engine is what revisits. A word in
    // two lists would also collide on the unique key in the database.
    const seen = curriculumWords.filter(
      (word, index) => curriculumWords.indexOf(word) !== index,
    );

    expect(seen).toEqual([]);
  });

  it("keeps lemma and part of speech unique, as the database requires", () => {
    const keys = LEXICON.map((seed) => `${seed.lemma}|${seed.partOfSpeech}`);
    const clashes = keys.filter((key, index) => keys.indexOf(key) !== index);

    expect(clashes).toEqual([]);
  });

  it("gives every noun a gender and nothing else one", () => {
    const wrong = LEXICON.filter(
      (seed) => (seed.partOfSpeech === "noun") !== (seed.gender !== null),
    );

    expect(wrong.map((seed) => seed.word)).toEqual([]);
  });

  it("strips the article out of the lemma", () => {
    const withArticle = LEXICON.filter((seed) =>
      /^(der|die|das) /.test(seed.lemma),
    );

    expect(withArticle.map((seed) => seed.lemma)).toEqual([]);
  });

  it("strips the reflexive pronoun out of the lemma", () => {
    const reflexive = LEXICON.filter((seed) => seed.word.startsWith("sich "));

    expect(reflexive.length).toBeGreaterThan(0);
    for (const seed of reflexive) {
      expect(seed.lemma).toBe(seed.word.slice("sich ".length));
    }
  });

  it("never carries a plural on something that is not a noun", () => {
    const wrong = LEXICON.filter(
      (seed) => seed.partOfSpeech !== "noun" && seed.plural !== null,
    );

    expect(wrong.map((seed) => seed.word)).toEqual([]);
  });

  it("gives every word a translation, a definition and an example", () => {
    for (const seed of LEXICON) {
      expect(seed.english.trim(), seed.word).not.toBe("");
      expect(seed.definition.trim(), seed.word).not.toBe("");
      expect(seed.example.trim(), seed.word).not.toBe("");
    }
  });

  it("writes definitions and examples as whole sentences", () => {
    const unfinished = LEXICON.filter(
      (seed) => !/[.!?]$/.test(seed.definition) || !/[.!?]$/.test(seed.example),
    );

    expect(unfinished.map((seed) => seed.word)).toEqual([]);
  });

  it("uses no double quote, which the generated SQL cannot carry", () => {
    const offenders = LEXICON.filter((seed) =>
      [seed.english, seed.definition, seed.example].some((text) =>
        text.includes('"'),
      ),
    );

    expect(offenders.map((seed) => seed.word)).toEqual([]);
  });
});
