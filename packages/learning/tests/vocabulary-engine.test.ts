import { describe, expect, it } from "vitest";

import { learnerVocabularySchema, type LearnerVocabulary } from "@dp/domain/vocabulary";
import {
  EXPOSURE_MASTERY_CEILING,
  MAX_VOCABULARY_WRITES_PER_TURN,
  vocabularyOutcomes,
  FAMILIAR_MASTERY,
  LAPSE_INTERVAL_DAYS,
  calculateConfidence,
  calculateMastery,
  deriveVocabularyStatus,
  newLearnerVocabulary,
  recordCorrectUse,
  recordExposure,
  recordIncorrectUse,
  reviewPriority,
  scheduleReview,
} from "../src/vocabulary-engine";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";

const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-03-01T09:00:00.000Z");
const at = (days: number) => new Date(START.getTime() + days * DAY);

function fresh(): LearnerVocabulary {
  return newLearnerVocabulary(LEARNER, ITEM);
}

/** Drives a record to a strong position through spaced correct recalls. */
function wellLearned(): LearnerVocabulary {
  let record = recordExposure(fresh(), at(0));
  for (const day of [1, 3, 8, 20, 45]) {
    record = recordCorrectUse(record, at(day));
  }
  return record;
}

describe("a word the learner has never met", () => {
  it("starts with nothing recorded", () => {
    const record = fresh();

    expect(record).toMatchObject({
      learnerId: LEARNER,
      vocabularyItemId: ITEM,
      exposureCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      masteryScore: 0,
      confidence: 0,
      lastSeenAt: null,
      nextReviewAt: null,
      status: "new",
    });
  });

  it("is a record the database would accept", () => {
    expect(learnerVocabularySchema.safeParse(fresh()).success).toBe(true);
  });
});

describe("exposure", () => {
  it("counts the encounter and remembers when it happened", () => {
    const record = recordExposure(fresh(), at(0));

    expect(record.exposureCount).toBe(1);
    expect(record.lastSeenAt).toEqual(at(0));
    expect(record.status).toBe("introduced");
  });

  it("does not leave the caller's record altered", () => {
    const before = fresh();
    recordExposure(before, at(0));

    expect(before.exposureCount).toBe(0);
    expect(before.lastSeenAt).toBeNull();
  });

  it("is not mastery, however often it is repeated", () => {
    // The heart of the model: seeing a word a hundred times is not evidence
    // that the learner can produce it. Exposure is capped well below the
    // score any confident status requires.
    let record = fresh();
    for (let turn = 0; turn < 100; turn += 1) {
      record = recordExposure(record, at(turn));
    }

    expect(record.exposureCount).toBe(100);
    expect(record.masteryScore).toBeLessThanOrEqual(EXPOSURE_MASTERY_CEILING);
    expect(record.masteryScore).toBeLessThan(FAMILIAR_MASTERY);
    expect(record.status).toBe("introduced");
  });

  it("leaves confidence untouched, because seeing is not producing", () => {
    const record = recordExposure(recordExposure(fresh(), at(0)), at(1));

    expect(record.confidence).toBe(0);
  });
});

describe("using a word correctly", () => {
  it("counts as an exposure too, so uses can never exceed encounters", () => {
    const record = recordCorrectUse(fresh(), at(0));

    expect(record.correctCount).toBe(1);
    expect(record.exposureCount).toBe(1);
    expect(learnerVocabularySchema.safeParse(record).success).toBe(true);
  });

  it("raises mastery and confidence", () => {
    const before = recordExposure(fresh(), at(0));
    const after = recordCorrectUse(before, at(1));

    expect(after.masteryScore).toBeGreaterThan(before.masteryScore);
    expect(after.confidence).toBeGreaterThan(before.confidence);
  });

  it("counts for more after a long gap than after a short one", () => {
    // Recalling a word three weeks later is stronger evidence than recalling
    // it a minute after being shown it. Spacing is the signal.
    const seen = recordExposure(fresh(), at(0));

    const immediate = recordCorrectUse(seen, new Date(START.getTime() + 60_000));
    const delayed = recordCorrectUse(seen, at(21));

    expect(delayed.masteryScore).toBeGreaterThan(immediate.masteryScore);
  });

  it("reaches mastered only through repeated spaced recall", () => {
    const record = wellLearned();

    expect(record.status).toBe("mastered");
    expect(record.masteryScore).toBeGreaterThanOrEqual(FAMILIAR_MASTERY);
  });

  it("never pushes a score above one", () => {
    let record = fresh();
    for (let turn = 0; turn < 50; turn += 1) {
      record = recordCorrectUse(record, at(turn * 30));
    }

    expect(record.masteryScore).toBeLessThanOrEqual(1);
    expect(record.confidence).toBeLessThanOrEqual(1);
  });
});

describe("getting a word wrong", () => {
  it("reduces confidence every time, down to nothing", () => {
    let record = wellLearned();
    const confidences = [record.confidence];

    for (let turn = 1; turn <= 6; turn += 1) {
      record = recordIncorrectUse(record, at(45 + turn));
      confidences.push(record.confidence);
    }

    // Strictly falling while there is anything left to lose, and it really
    // does reach zero rather than hovering just above it.
    const fallsWhileAboveZero = confidences.every(
      (value, index) =>
        index === 0 ||
        confidences[index - 1] === 0 ||
        value < confidences[index - 1],
    );

    expect(fallsWhileAboveZero).toBe(true);
    expect(confidences[0]).toBeGreaterThan(0);
    expect(record.confidence).toBe(0);
  });

  it("costs more mastery than a single correct use earns back", () => {
    const strong = wellLearned();
    const lapsed = recordIncorrectUse(strong, at(46));

    expect(lapsed.masteryScore).toBeLessThan(strong.masteryScore);
    expect(recordCorrectUse(lapsed, at(47)).masteryScore).toBeLessThan(
      strong.masteryScore,
    );
  });

  it("never drives a score below zero", () => {
    let record = fresh();
    for (let turn = 0; turn < 20; turn += 1) {
      record = recordIncorrectUse(record, at(turn));
    }

    expect(record.masteryScore).toBe(0);
    expect(record.confidence).toBe(0);
  });

  it("marks a word the learner keeps missing as weak", () => {
    let record = recordCorrectUse(fresh(), at(0));
    for (const day of [1, 2, 3]) {
      record = recordIncorrectUse(record, at(day));
    }

    expect(record.status).toBe("weak");
  });
});

describe("scoring", () => {
  it("treats an unknown gap as no gap rather than guessing", () => {
    const first = calculateMastery({
      masteryScore: 0.3,
      outcome: "correct",
      elapsedMs: null,
    });
    const immediate = calculateMastery({
      masteryScore: 0.3,
      outcome: "correct",
      elapsedMs: 0,
    });

    expect(first).toBe(immediate);
  });

  it("ignores a clock that appears to have run backwards", () => {
    const backwards = calculateMastery({
      masteryScore: 0.3,
      outcome: "correct",
      elapsedMs: -5 * DAY,
    });

    expect(backwards).toBe(
      calculateMastery({ masteryScore: 0.3, outcome: "correct", elapsedMs: 0 }),
    );
  });

  it("rounds to what the database column can hold", () => {
    // mastery_score is numeric(4,3). A score the column would silently round
    // makes the next calculation disagree with the stored one.
    let record = fresh();
    for (let turn = 0; turn < 12; turn += 1) {
      record = turn % 3 === 0
        ? recordIncorrectUse(record, at(turn))
        : recordCorrectUse(record, at(turn));

      expect(record.masteryScore * 1000).toBe(Math.round(record.masteryScore * 1000));
      expect(record.confidence * 1000).toBe(Math.round(record.confidence * 1000));
    }
  });

  it("keeps confidence inside the unit interval", () => {
    expect(calculateConfidence({ confidence: 1, outcome: "correct" })).toBe(1);
    expect(calculateConfidence({ confidence: 0, outcome: "incorrect" })).toBe(0);
  });
});

describe("status", () => {
  it("never claims a competence the mastery score contradicts", () => {
    // The database enforces this too. Deriving the status rather than setting
    // it means the two can never disagree.
    const claimed = deriveVocabularyStatus({
      exposureCount: 9,
      correctCount: 9,
      incorrectCount: 0,
      masteryScore: 0.1,
    });

    expect(["mastered", "familiar"]).not.toContain(claimed);
  });

  it("is new only before the learner has met the word", () => {
    expect(deriveVocabularyStatus({
      exposureCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      masteryScore: 0,
    })).toBe("new");
  });
});

describe("scheduling the next review", () => {
  it("always looks forward", () => {
    for (const mastery of [0, 0.25, 0.5, 0.75, 1]) {
      const next = scheduleReview({ masteryScore: mastery, lapsed: false }, START);

      expect(next.getTime()).toBeGreaterThan(START.getTime());
    }
  });

  it("waits longer the better the word is known", () => {
    const intervals = [0, 0.3, 0.5, 0.7, 0.9, 1].map((masteryScore) =>
      scheduleReview({ masteryScore, lapsed: false }, START).getTime(),
    );

    const nonDecreasing = intervals.every(
      (value, index) => index === 0 || value >= intervals[index - 1],
    );

    expect(nonDecreasing).toBe(true);
    expect(intervals.at(-1)).toBeGreaterThan(intervals[0]);
  });

  it("brings a word the learner just missed back tomorrow", () => {
    // Without this a well-known word that suddenly fails would still not be
    // seen again for weeks, which is exactly when it needs practice.
    const lapsed = scheduleReview({ masteryScore: 0.9, lapsed: true }, START);

    expect(lapsed.getTime() - START.getTime()).toBe(LAPSE_INTERVAL_DAYS * DAY);
  });

  it("is applied by every recording function", () => {
    const exposed = recordExposure(fresh(), at(0));
    const correct = recordCorrectUse(exposed, at(1));
    const wrong = recordIncorrectUse(correct, at(2));

    expect(exposed.nextReviewAt?.getTime()).toBeGreaterThan(at(0).getTime());
    expect(correct.nextReviewAt?.getTime()).toBeGreaterThan(at(1).getTime());
    expect(wrong.nextReviewAt?.getTime()).toBe(at(2).getTime() + LAPSE_INTERVAL_DAYS * DAY);
  });

  it("overrides the ladder when a strong word is suddenly missed", () => {
    // The lapse rule only earns its place on a word the ladder would
    // otherwise put weeks away. On a weak word both paths say tomorrow, so
    // testing it there would prove nothing.
    const lapsed = recordIncorrectUse(wellLearned(), at(46));
    const ladderWouldSay = scheduleReview(
      { masteryScore: lapsed.masteryScore, lapsed: false },
      at(46),
    );

    expect(ladderWouldSay.getTime()).toBeGreaterThan(
      at(46).getTime() + LAPSE_INTERVAL_DAYS * DAY,
    );
    expect(lapsed.nextReviewAt?.getTime()).toBe(
      at(46).getTime() + LAPSE_INTERVAL_DAYS * DAY,
    );
  });

  it("pushes a review further out after each spaced success", () => {
    const early = recordCorrectUse(recordExposure(fresh(), at(0)), at(1));
    const later = recordCorrectUse(early, at(5));

    const firstGap = early.nextReviewAt!.getTime() - at(1).getTime();
    const secondGap = later.nextReviewAt!.getTime() - at(5).getTime();

    expect(secondGap).toBeGreaterThan(firstGap);
  });
});

describe("review priority", () => {
  const base = wellLearned();
  const now = at(200);

  it("puts the most overdue word first", () => {
    const overdue = { ...base, nextReviewAt: at(100) };
    const justDue = { ...base, nextReviewAt: at(199) };

    expect(reviewPriority(overdue, now)).toBeGreaterThan(
      reviewPriority(justDue, now),
    );
  });

  it("breaks a tie in favour of the weaker word", () => {
    const shaky = { ...base, nextReviewAt: at(150), masteryScore: 0.3 };
    const solid = { ...base, nextReviewAt: at(150), masteryScore: 0.9 };

    expect(reviewPriority(shaky, now)).toBeGreaterThan(reviewPriority(solid, now));
  });

  it("ranks a word that has never been scheduled as waiting", () => {
    const unscheduled = { ...base, nextReviewAt: null };

    expect(reviewPriority(unscheduled, now)).toBeGreaterThan(0);
  });
});

describe("every recorded event", () => {
  it("produces a record the database will accept", () => {
    let record = fresh();
    const events = [
      recordExposure,
      recordCorrectUse,
      recordIncorrectUse,
      recordCorrectUse,
      recordExposure,
      recordIncorrectUse,
      recordCorrectUse,
    ];

    events.forEach((apply, index) => {
      record = apply(record, at(index));
      const parsed = learnerVocabularySchema.safeParse(record);

      expect(parsed.success, `event ${index} produced an invalid record`).toBe(true);
    });
  });
});


describe("reading one evaluation's word lists", () => {
  const EMPTY = {
    vocabularyUsed: [],
    vocabularyWeaknesses: [],
    masterySignals: [],
    reviewCandidates: [],
  };

  it("marks a used word correct and a weak word incorrect", () => {
    const outcomes = vocabularyOutcomes({
      ...EMPTY,
      vocabularyUsed: ["fahren"],
      vocabularyWeaknesses: ["der Zug"],
    });

    expect(outcomes.get("fahren")).toBe("correct");
    expect(outcomes.get("der Zug")).toBe("incorrect");
  });

  it("lets evidence of trouble beat evidence of use", () => {
    // A word can appear in both lists — used, and used wrongly. Counting it
    // as correct would march it towards mastered on the strength of errors.
    const outcomes = vocabularyOutcomes({
      ...EMPTY,
      vocabularyUsed: ["umsteigen"],
      vocabularyWeaknesses: ["umsteigen"],
    });

    expect(outcomes.get("umsteigen")).toBe("incorrect");
  });

  it("keeps the precedence whatever order the lists arrive in", () => {
    const outcomes = vocabularyOutcomes({
      ...EMPTY,
      vocabularyUsed: ["umsteigen"],
      masterySignals: [{ lemma: "umsteigen", direction: "down" }],
    });

    expect(outcomes.get("umsteigen")).toBe("incorrect");
  });

  it("reads mastery signals by their direction", () => {
    const outcomes = vocabularyOutcomes({
      ...EMPTY,
      masterySignals: [
        { lemma: "fahren", direction: "up" },
        { lemma: "das Gleis", direction: "down" },
      ],
    });

    expect(outcomes.get("fahren")).toBe("correct");
    expect(outcomes.get("das Gleis")).toBe("incorrect");
  });

  it("treats a review candidate as an encounter, not an achievement", () => {
    const outcomes = vocabularyOutcomes({
      ...EMPTY,
      reviewCandidates: ["die Verspätung"],
    });

    expect(outcomes.get("die Verspätung")).toBe("exposure");
  });

  it("lets any use beat a bare mention", () => {
    const outcomes = vocabularyOutcomes({
      ...EMPTY,
      vocabularyUsed: ["die Verspätung"],
      reviewCandidates: ["die Verspätung"],
    });

    expect(outcomes.get("die Verspätung")).toBe("correct");
  });

  it("ignores blank lemmas rather than writing rows about nothing", () => {
    const outcomes = vocabularyOutcomes({
      ...EMPTY,
      vocabularyUsed: ["  ", "fahren "],
    });

    expect(outcomes.size).toBe(1);
    expect(outcomes.get("fahren")).toBe("correct");
  });

  it("bounds the writes one turn can cause", () => {
    // Every entry is an upsert on the turn's own clock.
    const many = Array.from({ length: 50 }, (_, i) => `wort${i}`);

    const outcomes = vocabularyOutcomes({ ...EMPTY, vocabularyUsed: many });

    expect(outcomes.size).toBe(MAX_VOCABULARY_WRITES_PER_TURN);
  });

  it("returns nothing for an evaluation that observed nothing", () => {
    expect(vocabularyOutcomes(EMPTY).size).toBe(0);
  });
});
