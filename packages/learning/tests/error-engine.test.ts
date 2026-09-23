import { describe, expect, it } from "vitest";

import {
  MAX_STORED_EXAMPLES,
  errorObservationSchema,
  learnerErrorSchema,
  normaliseErrorPattern,
  type LearnerError,
} from "@dp/domain/learner-error";
import {
  RECURRING_THRESHOLD,
  SIGNAL_HALF_LIFE_DAYS,
  aggregateObservation,
  isRecurring,
  learningSignals,
  markResolved,
} from "../src/error-engine";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const ERROR_ID = "33333333-3333-4333-8333-333333333333";
const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-06-01T10:00:00.000Z");
const at = (days: number) => new Date(START.getTime() + days * DAY);

function observation(overrides: Record<string, unknown> = {}) {
  return errorObservationSchema.parse({
    learnerId: LEARNER,
    errorType: "word_order",
    pattern: "verb not in final position in a weil-clause",
    utterance: "Ich bleibe zu Hause, weil ich bin müde.",
    observedAt: START,
    ...overrides,
  });
}

/** An aggregate built by replaying `times` observations, one per day. */
function afterOccurrences(times: number, overrides: Record<string, unknown> = {}) {
  let error: LearnerError | null = null;
  for (let day = 0; day < times; day += 1) {
    error = aggregateObservation(
      error,
      observation({ observedAt: at(day), utterance: `Satz Nummer ${day}.`, ...overrides }),
      ERROR_ID,
    );
  }
  return error as LearnerError;
}

describe("normalising a pattern", () => {
  it("treats the same description written differently as one pattern", () => {
    // Aggregation lives or dies here. The pattern is written by a model, so
    // spacing and capitalisation vary between turns; if that produced a new
    // row each time there would be no aggregate to count.
    const variants = [
      "Verb not in final position in a weil-clause",
      "verb not in final position in a weil-clause",
      "  verb  not in final   position in a weil-clause  ",
      "verb not in final position in a weil-clause.",
      "Verb not in final position in a weil-clause!",
    ];

    expect(new Set(variants.map(normaliseErrorPattern)).size).toBe(1);
  });

  it("keeps genuinely different patterns apart", () => {
    expect(normaliseErrorPattern("wrong gender on Tisch")).not.toBe(
      normaliseErrorPattern("wrong gender on Tür"),
    );
  });

  it("collapses newlines and tabs, which a model reply carries", () => {
    expect(normaliseErrorPattern("verb\n\tnot final")).toBe("verb not final");
  });

  it("refuses a pattern that is empty once normalised", () => {
    for (const empty of ["", "   ", "...", "\n"]) {
      expect(
        errorObservationSchema.safeParse({ ...observation(), pattern: empty }).success,
      ).toBe(false);
    }
  });

  it("refuses a pattern too long for the column", () => {
    const parsed = errorObservationSchema.safeParse({
      ...observation(),
      pattern: "a".repeat(301),
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses an error type outside the taxonomy", () => {
    const parsed = errorObservationSchema.safeParse({
      ...observation(),
      errorType: "vibes",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("the first time a mistake is seen", () => {
  const first = aggregateObservation(null, observation(), ERROR_ID);

  it("opens an aggregate counted once", () => {
    expect(first).toMatchObject({
      learnerId: LEARNER,
      errorType: "word_order",
      occurrenceCount: 1,
      resolved: false,
      firstSeenAt: START,
      lastSeenAt: START,
    });
  });

  it("stores the normalised pattern, not the raw text", () => {
    const raw = aggregateObservation(
      null,
      observation({ pattern: "  Verb NOT Final.  " }),
      ERROR_ID,
    );

    expect(raw.pattern).toBe("verb not final");
  });

  it("keeps the utterance as evidence", () => {
    expect(first.exampleUtterances).toEqual([
      "Ich bleibe zu Hause, weil ich bin müde.",
    ]);
  });

  it("is a record the database would accept", () => {
    expect(learnerErrorSchema.safeParse(first).success).toBe(true);
  });
});

describe("the same mistake again", () => {
  it("increments the count rather than adding a record", () => {
    const seven = afterOccurrences(7);

    expect(seven.occurrenceCount).toBe(7);
  });

  it("widens the window it was seen in", () => {
    const seven = afterOccurrences(7);

    expect(seven.firstSeenAt).toEqual(at(0));
    expect(seven.lastSeenAt).toEqual(at(6));
  });

  it("keeps the newest examples when the cap is reached", () => {
    // The cap exists because this row is an aggregate, not a log. Keeping the
    // oldest would freeze the evidence at whatever the learner did first.
    const many = afterOccurrences(MAX_STORED_EXAMPLES + 5);

    expect(many.exampleUtterances).toHaveLength(MAX_STORED_EXAMPLES);
    expect(many.exampleUtterances[0]).toBe(
      `Satz Nummer ${MAX_STORED_EXAMPLES + 4}.`,
    );
    expect(learnerErrorSchema.safeParse(many).success).toBe(true);
  });

  it("does not store the same sentence twice", () => {
    let error = aggregateObservation(null, observation({ utterance: "Weil ich bin müde." }), ERROR_ID);
    error = aggregateObservation(
      error,
      observation({ observedAt: at(1), utterance: "Weil ich bin müde." }),
      ERROR_ID,
    );

    expect(error.occurrenceCount).toBe(2);
    expect(error.exampleUtterances).toEqual(["Weil ich bin müde."]);
  });

  it("survives an observation that arrives out of order", () => {
    // Clock skew must not produce a row the database refuses.
    const later = aggregateObservation(null, observation({ observedAt: at(5) }), ERROR_ID);
    const earlier = aggregateObservation(later, observation({ observedAt: at(1) }), ERROR_ID);

    expect(earlier.firstSeenAt).toEqual(at(1));
    expect(earlier.lastSeenAt).toEqual(at(5));
    expect(learnerErrorSchema.safeParse(earlier).success).toBe(true);
  });

  it("accepts an observation with no example sentence", () => {
    const error = aggregateObservation(
      null,
      observation({ utterance: undefined }),
      ERROR_ID,
    );

    expect(error.exampleUtterances).toEqual([]);
  });
});

describe("resolving a mistake", () => {
  it("marks it corrected without losing the history", () => {
    const resolved = markResolved(afterOccurrences(7));

    expect(resolved.resolved).toBe(true);
    expect(resolved.occurrenceCount).toBe(7);
  });

  it("reopens it when the learner makes it again", () => {
    // A mistake that comes back was not resolved. Leaving it closed would
    // hide the one pattern most worth working on.
    const resolved = markResolved(afterOccurrences(7));
    const relapse = aggregateObservation(resolved, observation({ observedAt: at(30) }), ERROR_ID);

    expect(relapse.resolved).toBe(false);
    expect(relapse.occurrenceCount).toBe(8);
  });
});

describe("which mistakes become learning signals", () => {
  const recurring = { ...afterOccurrences(7), lastSeenAt: at(0) };

  it("ignores a one-off", () => {
    const once = { ...afterOccurrences(1), lastSeenAt: at(0) };

    expect(isRecurring(once)).toBe(false);
    expect(learningSignals([once], at(0))).toEqual([]);
  });

  it("promotes a pattern seen often enough to be a habit", () => {
    expect(isRecurring(recurring)).toBe(true);
    expect(learningSignals([recurring], at(0))).toHaveLength(1);
  });

  it("drops anything the learner has corrected", () => {
    expect(learningSignals([markResolved(recurring)], at(0))).toEqual([]);
  });

  it("ranks the more frequent mistake first", () => {
    const rare = {
      ...recurring,
      pattern: "wrong article",
      occurrenceCount: RECURRING_THRESHOLD,
    };

    const signals = learningSignals([rare, recurring], at(0));

    expect(signals.map((signal) => signal.pattern)).toEqual([
      recurring.pattern,
      "wrong article",
    ]);
  });

  it("lets a stale mistake fall behind a fresher one", () => {
    // Something last done three months ago is weaker evidence than something
    // from yesterday, however many times it happened back then.
    const stale = { ...recurring, occurrenceCount: 20, lastSeenAt: at(-90) };
    const fresh = { ...recurring, pattern: "wrong case after mit", occurrenceCount: 4 };

    const signals = learningSignals([stale, fresh], at(0));

    expect(signals[0]?.pattern).toBe("wrong case after mit");
  });

  it("halves the weight of a mistake one half-life old", () => {
    const fresh = learningSignals([recurring], at(0))[0];
    const aged = learningSignals(
      [{ ...recurring, lastSeenAt: at(-SIGNAL_HALF_LIFE_DAYS) }],
      at(0),
    )[0];

    expect(aged.priority).toBeCloseTo(fresh.priority / 2, 6);
  });

  it("caps the list, because these go into a prompt", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...recurring,
      pattern: `pattern ${index}`,
    }));

    const signals = learningSignals(many, at(0));

    expect(signals.length).toBeLessThanOrEqual(5);
    expect(signals.length).toBeGreaterThan(0);
  });

  it("honours a smaller requested limit", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      ...recurring,
      pattern: `pattern ${index}`,
    }));

    expect(learningSignals(many, at(0), 2)).toHaveLength(2);
  });

  it("carries the evidence, so the tutor can quote it back", () => {
    const [signal] = learningSignals([recurring], at(0));

    expect(signal.examples.length).toBeGreaterThan(0);
    expect(signal.errorType).toBe("word_order");
    expect(signal.occurrenceCount).toBe(7);
  });
});
