import { describe, expect, it } from "vitest";

import type { LearnerVocabulary, VocabularyItem } from "@dp/domain/vocabulary";
import { vocabularyWords } from "@/lib/dashboard/vocabulary";
import { WEAK_MASTERY_THRESHOLD, WEAK_MIN_EXPOSURES } from "@dp/learning/review";

/**
 * The words behind the dashboard's four numbers.
 *
 * The property that matters most is agreement: these predicates mirror the
 * ones the tiles are counted with in the learner_dashboard function, and a
 * list that disagrees with the number above it is worse than no list at all.
 */

const NOW = new Date("2026-08-25T12:00:00.000Z");
const LEARNER = "11111111-1111-4111-8111-111111111111";

let nextId = 0;
const id = () => {
  nextId += 1;
  return `22222222-2222-4222-8222-${String(nextId).padStart(12, "0")}`;
};

function word(over: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: id(),
    lemma: "Bahnhof",
    word: "der Bahnhof",
    partOfSpeech: "noun",
    gender: "der",
    plural: "die Bahnhöfe",
    englishTranslation: "station",
    germanDefinition: "Ein Ort für Züge.",
    example: "Der Bahnhof ist links.",
    collocations: [],
    commonMistakes: [],
    cefr: "A1",
    miniLevel: 1,
    topic: "travel",
    frequencyBand: 1,
    isCoreWord: true,
    ...over,
  } as VocabularyItem;
}

function progress(
  item: VocabularyItem,
  over: Partial<LearnerVocabulary> = {},
): LearnerVocabulary {
  return {
    learnerId: LEARNER,
    vocabularyItemId: item.id,
    exposureCount: 1,
    correctCount: 1,
    incorrectCount: 0,
    masteryScore: 0.3,
    confidence: 0.3,
    lastSeenAt: NOW,
    nextReviewAt: null,
    status: "learning",
    ...over,
  };
}

function bucketsFor(pairs: Array<[VocabularyItem, Partial<LearnerVocabulary>]>) {
  return vocabularyWords({
    records: pairs.map(([item, over]) => progress(item, over)),
    items: pairs.map(([item]) => item),
    now: NOW,
  });
}

describe("known", () => {
  it("holds every word the learner has met", () => {
    const buckets = bucketsFor([
      [word({ lemma: "Haus", word: "das Haus", gender: "das" }), {}],
      [word({ lemma: "Bahnhof", word: "der Bahnhof" }), {}],
    ]);

    expect(buckets.known.map((entry) => entry.word)).toEqual(["Bahnhof", "Haus"]);
  });

  it("files a noun under the noun, not under its article", () => {
    // Which is what a German dictionary does, and the reason the article is
    // carried separately rather than left on the front of the word.
    const buckets = bucketsFor([
      [word({ lemma: "Zug", word: "der Zug" }), {}],
      [word({ lemma: "Apfel", word: "der Apfel" }), {}],
    ]);

    expect(buckets.known.map((entry) => entry.word)).toEqual(["Apfel", "Zug"]);
  });

  it("carries the article and the English separately, ready to render", () => {
    const buckets = bucketsFor([[word(), {}]]);

    expect(buckets.known[0]).toMatchObject({
      word: "Bahnhof",
      article: "der",
      english: "station",
    });
  });

  it("keeps a word that has no article at all", () => {
    const buckets = bucketsFor([
      [word({ lemma: "gehen", word: "gehen", partOfSpeech: "verb", gender: null }), {}],
    ]);

    expect(buckets.known[0]).toMatchObject({ word: "gehen", article: null });
  });

  it("drops a progress row whose word could not be loaded", () => {
    // Rather than showing an id. The panel compares the list against the tile
    // and says it is short, which is the visible version of this.
    const buckets = vocabularyWords({
      records: [progress(word())],
      items: [],
      now: NOW,
    });

    expect(buckets.known).toEqual([]);
  });
});

describe("mastered", () => {
  it("holds the words whose status says so", () => {
    const buckets = bucketsFor([
      [word({ lemma: "Haus", word: "das Haus", gender: "das" }),
        { status: "mastered", masteryScore: 0.9 }],
      [word({ lemma: "Zug", word: "der Zug" }), {}],
    ]);

    expect(buckets.mastered.map((entry) => entry.word)).toEqual(["Haus"]);
  });

  it("does not promote a familiar word", () => {
    // The tile counts status = 'mastered' exactly, so this list must too.
    const buckets = bucketsFor([
      [word(), { status: "familiar", masteryScore: 0.8 }],
    ]);

    expect(buckets.mastered).toEqual([]);
  });
});

describe("due", () => {
  it("holds the words whose review date has passed", () => {
    const buckets = bucketsFor([
      [word({ lemma: "Zug", word: "der Zug" }),
        { nextReviewAt: new Date("2026-08-24T12:00:00.000Z") }],
      [word({ lemma: "Haus", word: "das Haus", gender: "das" }),
        { nextReviewAt: new Date("2026-08-26T12:00:00.000Z") }],
    ]);

    expect(buckets.due.map((entry) => entry.word)).toEqual(["Zug"]);
  });

  it("holds nothing for a word with no review date", () => {
    // Null compares to nothing in SQL, and the tile counts it as not due.
    expect(bucketsFor([[word(), { nextReviewAt: null }]]).due).toEqual([]);
  });

  it("never lists a mastered word, however overdue", () => {
    const buckets = bucketsFor([
      [word(), {
        status: "mastered",
        masteryScore: 0.9,
        nextReviewAt: new Date("2026-01-01T00:00:00.000Z"),
      }],
    ]);

    expect(buckets.due).toEqual([]);
  });

  it("puts the most overdue first, because the list is a thing to act on", () => {
    const buckets = bucketsFor([
      [word({ lemma: "Zug", word: "der Zug" }),
        { nextReviewAt: new Date("2026-08-24T12:00:00.000Z") }],
      [word({ lemma: "Apfel", word: "der Apfel" }),
        { nextReviewAt: new Date("2026-08-01T12:00:00.000Z") }],
    ]);

    expect(buckets.due.map((entry) => entry.word)).toEqual(["Apfel", "Zug"]);
  });
});

describe("tricky", () => {
  it("needs both a low score and enough exposures to mean it", () => {
    const buckets = bucketsFor([
      [word({ lemma: "Zug", word: "der Zug" }),
        { exposureCount: WEAK_MIN_EXPOSURES, masteryScore: 0.2 }],
      // Low, but seen once — not yet evidence of anything.
      [word({ lemma: "Haus", word: "das Haus", gender: "das" }),
        { exposureCount: WEAK_MIN_EXPOSURES - 1, masteryScore: 0.1 }],
      // Seen often and doing fine.
      [word({ lemma: "Apfel", word: "der Apfel" }),
        { exposureCount: 10, masteryScore: WEAK_MASTERY_THRESHOLD }],
    ]);

    expect(buckets.tricky.map((entry) => entry.word)).toEqual(["Zug"]);
  });

  it("puts the weakest first", () => {
    const buckets = bucketsFor([
      [word({ lemma: "Zug", word: "der Zug" }), { exposureCount: 5, masteryScore: 0.4 }],
      [word({ lemma: "Apfel", word: "der Apfel" }), { exposureCount: 5, masteryScore: 0.1 }],
    ]);

    expect(buckets.tricky.map((entry) => entry.word)).toEqual(["Apfel", "Zug"]);
  });

  it("breaks a tie on the number of exposures behind the same score", () => {
    const buckets = bucketsFor([
      [word({ lemma: "Zug", word: "der Zug" }), { exposureCount: 4, masteryScore: 0.2 }],
      [word({ lemma: "Apfel", word: "der Apfel" }), { exposureCount: 9, masteryScore: 0.2 }],
    ]);

    expect(buckets.tricky.map((entry) => entry.word)).toEqual(["Apfel", "Zug"]);
  });
});

describe("a learner with nothing yet", () => {
  it("gets four empty lists rather than a failure", () => {
    expect(vocabularyWords({ records: [], items: [], now: NOW })).toEqual({
      known: [],
      mastered: [],
      due: [],
      tricky: [],
    });
  });
});

describe("one word can be in more than one list", () => {
  it("appears as both due and tricky when it is both", () => {
    const both = word({ lemma: "Zug", word: "der Zug" });
    const buckets = bucketsFor([
      [both, {
        exposureCount: 6,
        masteryScore: 0.1,
        nextReviewAt: new Date("2026-08-20T12:00:00.000Z"),
      }],
    ]);

    expect(buckets.due.map((entry) => entry.word)).toEqual(["Zug"]);
    expect(buckets.tricky.map((entry) => entry.word)).toEqual(["Zug"]);
    expect(buckets.known.map((entry) => entry.word)).toEqual(["Zug"]);
  });
});
