import { describe, expect, it } from "vitest";

import type { LearnerVocabulary } from "@dp/domain/vocabulary";
import {
  JUST_PRACTISED_HOURS,
  MAX_REVIEW_ITEMS,
  WEAK_MASTERY_THRESHOLD,
  WEAK_MIN_EXPOSURES,
  activityForWord,
  buildReviewPlan,
  daysOverdue,
  dueForReview,
  weakVocabulary,
} from "../src/review";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const days = (count: number) => new Date(NOW.getTime() + count * 86_400_000);

let counter = 0;
const word = (over: Partial<LearnerVocabulary> = {}): LearnerVocabulary => ({
  learnerId: "11111111-1111-4111-8111-111111111111",
  vocabularyItemId: `word-${(counter += 1)}`,
  exposureCount: 5,
  correctCount: 2,
  incorrectCount: 1,
  masteryScore: 0.4,
  confidence: 0.4,
  lastSeenAt: days(-3),
  nextReviewAt: days(-1),
  status: "learning",
  ...over,
});

describe("how overdue a word is", () => {
  it("counts whole days past the review date", () => {
    expect(daysOverdue(word({ nextReviewAt: days(-3) }), NOW)).toBe(3);
  });

  it("is negative for a word not yet due", () => {
    expect(daysOverdue(word({ nextReviewAt: days(2) }), NOW)).toBeLessThan(0);
  });

  it("is nothing at all for a word never scheduled", () => {
    // Never scheduled is not the same as infinitely late.
    expect(daysOverdue(word({ nextReviewAt: null }), NOW)).toBeNull();
  });
});

describe("what is due", () => {
  it("returns the words past their date, most overdue first", () => {
    const due = dueForReview(
      [
        word({ vocabularyItemId: "a", nextReviewAt: days(-1) }),
        word({ vocabularyItemId: "b", nextReviewAt: days(-9) }),
        word({ vocabularyItemId: "c", nextReviewAt: days(-4) }),
      ],
      NOW,
    );

    expect(due.map((item) => item.record.vocabularyItemId)).toEqual(["b", "c", "a"]);
  });

  it("leaves out a word that is not due yet", () => {
    expect(dueForReview([word({ nextReviewAt: days(3) })], NOW)).toEqual([]);
  });

  it("leaves out a mastered word", () => {
    // The point of mastery is that it stops taking a learner's attention.
    expect(
      dueForReview([word({ status: "mastered", nextReviewAt: days(-30) })], NOW),
    ).toEqual([]);
  });

  it("leaves out a word never scheduled", () => {
    expect(dueForReview([word({ nextReviewAt: null })], NOW)).toEqual([]);
  });

  it("bounds the session", () => {
    const many = Array.from({ length: 60 }, () => word());

    expect(dueForReview(many, NOW)).toHaveLength(MAX_REVIEW_ITEMS);
  });

  it("counts them all when asked for a total rather than a session", () => {
    // The bound is right for a sitting and wrong for a sentence about how far
    // behind somebody is. The Catch up page states the total and lists the
    // session; the nav badge counts the same total in the database, and the
    // two must not contradict each other at the twenty-first overdue word.
    const many = Array.from({ length: 60 }, () => word());

    expect(dueForReview(many, NOW, many.length)).toHaveLength(60);
  });

  it("gives the same session twice for the same state", () => {
    const records = [
      word({ vocabularyItemId: "b", nextReviewAt: days(-2) }),
      word({ vocabularyItemId: "a", nextReviewAt: days(-2) }),
    ];

    expect(dueForReview(records, NOW).map((i) => i.record.vocabularyItemId)).toEqual(
      dueForReview(records, NOW).map((i) => i.record.vocabularyItemId),
    );
  });
});

describe("what is weak", () => {
  it("returns words seen often and still not known", () => {
    const weak = weakVocabulary(
      [
        word({ vocabularyItemId: "known", masteryScore: 0.9 }),
        word({ vocabularyItemId: "tricky", masteryScore: 0.2, exposureCount: 8 }),
      ],
      NOW,
    );

    expect(weak.map((record) => record.vocabularyItemId)).toEqual(["tricky"]);
  });

  it("ignores a word barely met, which is new rather than weak", () => {
    expect(
      weakVocabulary(
        [word({ masteryScore: 0.1, exposureCount: WEAK_MIN_EXPOSURES - 1 })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("puts the weakest first", () => {
    const weak = weakVocabulary(
      [
        word({ vocabularyItemId: "a", masteryScore: 0.45 }),
        word({ vocabularyItemId: "b", masteryScore: 0.05 }),
      ],
      NOW,
    );

    expect(weak[0].vocabularyItemId).toBe("b");
  });

  it("leaves out a word the learner has just practised", () => {
    // Answered ten minutes ago in the trainer. Still weak, but offering it
    // straight back reads as though the work did not count.
    const hoursAgo = (count: number) => new Date(NOW.getTime() - count * 3_600_000);

    expect(
      weakVocabulary([word({ masteryScore: 0.2, lastSeenAt: hoursAgo(0.2) })], NOW),
    ).toEqual([]);
    expect(
      weakVocabulary(
        [word({ masteryScore: 0.2, lastSeenAt: hoursAgo(JUST_PRACTISED_HOURS + 1) })],
        NOW,
      ),
    ).toHaveLength(1);
  });

  it("keeps a weak word never seen, which is not the same as practised", () => {
    expect(
      weakVocabulary([word({ masteryScore: 0.2, lastSeenAt: null })], NOW),
    ).toHaveLength(1);
  });

  it("draws the line where the threshold says", () => {
    expect(
      weakVocabulary([word({ masteryScore: WEAK_MASTERY_THRESHOLD })], NOW),
    ).toEqual([]);
    expect(
      weakVocabulary([word({ masteryScore: WEAK_MASTERY_THRESHOLD - 0.01 })], NOW),
    ).toHaveLength(1);
  });
});

describe("what kind of practice a word needs", () => {
  it("asks a barely-met word to be recognised, not recalled", () => {
    // Asking for a cold recall of a word seen twice produces a blank, which
    // teaches nothing and feels like failure.
    expect(activityForWord(word({ masteryScore: 0.2 }))).toBe("recognise");
  });

  it("asks a half-known word to be recalled", () => {
    expect(activityForWord(word({ masteryScore: 0.5 }))).toBe("recall");
  });

  it("asks a well-known word to be used", () => {
    expect(activityForWord(word({ masteryScore: 0.85 }))).toBe("use_in_sentence");
  });
});

/**
 * The word a progress row points at. The plan reads three fields; the cast
 * spares the tests carrying a full dictionary entry per word.
 */
const item = (id: string, over: { word?: string; english?: string } = {}) =>
  ({
    id,
    word: over.word ?? id,
    englishTranslation: over.english ?? `the ${id}`,
  }) as unknown as import("@dp/domain/vocabulary").VocabularyItem;

const itemsFor = (records: ReadonlyArray<{ vocabularyItemId: string }>) =>
  records.map((record) => item(record.vocabularyItemId));

describe("the session", () => {
  it("puts overdue words first, then weak ones, then recurring mistakes", () => {
    const vocabulary = [
      word({ vocabularyItemId: "overdue", nextReviewAt: days(-5) }),
      word({ vocabularyItemId: "weak", nextReviewAt: days(5), masteryScore: 0.1 }),
    ];
    const plan = buildReviewPlan({
      vocabulary,
      items: itemsFor(vocabulary),
      recurringErrors: [
        { errorType: "case_dative", pattern: "uses the accusative after mit" },
      ],
      now: NOW,
    });

    expect(plan.activities.map((activity) => activity.subject)).toEqual([
      "overdue",
      "weak",
      // The label a learner reads, never the type key: this subject is said
      // aloud in the trainer's agenda and printed on the review page.
      "The dative case",
    ]);
  });

  it("keeps the recorded note as the prompt, not a fake exercise", () => {
    // The note describes what keeps going wrong; it is not a sentence to fix.
    // The old text put "Fix the sentence:" in front of it, and the trainer
    // read that out to a learner with nothing to fix.
    const plan = buildReviewPlan({
      vocabulary: [],
      items: [],
      recurringErrors: [
        { errorType: "case_dative", pattern: "uses the accusative after mit" },
      ],
      now: NOW,
    });

    expect(plan.activities[0]?.prompt).toBe("uses the accusative after mit");
    expect(plan.activities[0]?.prompt).not.toContain("Fix the sentence");
  });

  it("offers each mistake category once per session, however often it was recorded", () => {
    // Two spelling errors are one weakness. A session that lists "Spelling"
    // twice reads as a stutter; the second instance waits for a later sitting.
    const plan = buildReviewPlan({
      vocabulary: [],
      items: [],
      recurringErrors: [
        { errorType: "spelling", pattern: "lowercase ich" },
        { errorType: "spelling", pattern: "Straße with ss" },
        { errorType: "article", pattern: "der before Haus" },
      ],
      now: NOW,
    });

    expect(plan.activities.map((activity) => activity.subject)).toEqual([
      "Spelling",
      "Articles",
    ]);
    // The first recorded instance is the one taught.
    expect(plan.activities[0]?.prompt).toBe("lowercase ich");
  });

  it("does not offer the same word twice", () => {
    // A word can be both overdue and weak; twice in one session is padding.
    const both = word({
      vocabularyItemId: "both",
      nextReviewAt: days(-2),
      masteryScore: 0.1,
    });

    const plan = buildReviewPlan({
      vocabulary: [both],
      items: itemsFor([both]),
      recurringErrors: [],
      now: NOW,
    });

    expect(plan.activities).toHaveLength(1);
  });

  it("bounds the whole session, not each part of it", () => {
    const vocabulary = Array.from({ length: 40 }, () => word());
    const plan = buildReviewPlan({
      vocabulary,
      items: itemsFor(vocabulary),
      recurringErrors: [
        { errorType: "word_order", pattern: "verb second" },
      ],
      now: NOW,
      limit: 5,
    });

    expect(plan.activities).toHaveLength(5);
  });

  it("keeps a just-practised word out of the session entirely", () => {
    // The review page reads this plan, so a word answered correctly in the
    // trainer a minute ago must not still be listed as something to go over.
    const practised = word({
      vocabularyItemId: "just-done",
      masteryScore: 0.2,
      lastSeenAt: new Date(NOW.getTime() - 60_000),
      nextReviewAt: days(2),
    });

    const plan = buildReviewPlan({
      vocabulary: [practised],
      items: itemsFor([practised]),
      recurringErrors: [],
      now: NOW,
    });

    expect(plan.weak).toEqual([]);
    expect(plan.activities).toEqual([]);
  });

  it("produces nothing when there is nothing to review", () => {
    const mastered = [word({ status: "mastered" })];
    const plan = buildReviewPlan({
      vocabulary: mastered,
      items: itemsFor(mastered),
      recurringErrors: [],
      now: NOW,
    });

    expect(plan.activities).toEqual([]);
  });

  it("writes a prompt a learner can actually act on", () => {
    const records = [word({ vocabularyItemId: "zug-id", masteryScore: 0.9 })];
    const plan = buildReviewPlan({
      vocabulary: records,
      items: [item("zug-id", { word: "der Zug", english: "the train" })],
      recurringErrors: [],
      now: NOW,
    });

    expect(plan.activities[0].prompt).toContain("der Zug");
    expect(plan.activities[0].prompt.length).toBeGreaterThan(15);
  });

  it("asks each question from the right half of the pair", () => {
    // Recognition shows the German; recall shows the English and asks for
    // the German; production hands the German over.
    const recognise = [word({ vocabularyItemId: "z", masteryScore: 0.1 })];
    const recall = [word({ vocabularyItemId: "z", masteryScore: 0.5 })];
    const items = [item("z", { word: "der Zug", english: "the train" })];

    const recognised = buildReviewPlan({
      vocabulary: recognise, items, recurringErrors: [], now: NOW,
    }).activities[0];
    const recalled = buildReviewPlan({
      vocabulary: recall, items, recurringErrors: [], now: NOW,
    }).activities[0];

    expect(recognised?.prompt).toBe('What does "der Zug" mean?');
    expect(recalled?.prompt).toBe('What is the German for "the train"?');
  });

  it("never lets a row id reach a learner", () => {
    // The first real progress rows produced 'Which of these means
    // "4e3b1123-…"?' — an id asked as a vocabulary question. A record whose
    // word was not fetched is dropped, not rendered.
    const records = [
      word({ vocabularyItemId: "4e3b1123-6367-4afc-b177-fff5a98a5d75" }),
    ];

    const plan = buildReviewPlan({
      vocabulary: records,
      items: [],
      recurringErrors: [],
      now: NOW,
    });

    expect(plan.activities).toEqual([]);
    expect(JSON.stringify(plan.activities)).not.toMatch(/4e3b1123/);
  });
});
