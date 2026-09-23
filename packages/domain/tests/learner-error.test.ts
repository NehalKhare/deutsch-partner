import { describe, expect, it } from "vitest";
import { ERROR_TYPES, learnerErrorSchema } from "../src/learner-error";

const recurring = {
  id: "33333333-3333-4333-8333-333333333333",
  learnerId: "11111111-1111-4111-8111-111111111111",
  errorType: "word_order",
  pattern: "verb placed third in a main clause",
  occurrenceCount: 7,
  firstSeenAt: "2026-07-01T10:00:00.000Z",
  lastSeenAt: "2026-08-20T10:00:00.000Z",
  resolved: false,
  exampleUtterances: ["Ich morgen gehe ins Kino."],
};

describe("learnerErrorSchema", () => {
  it("accepts an aggregated recurring error", () => {
    expect(learnerErrorSchema.parse(recurring).occurrenceCount).toBe(7);
  });

  it("covers the grammar areas the curriculum teaches", () => {
    expect(ERROR_TYPES).toContain("word_order");
    expect(ERROR_TYPES).toContain("case_dative");
    expect(ERROR_TYPES).toContain("adjective_ending");
  });

  it("rejects an error type outside the closed taxonomy", () => {
    expect(
      learnerErrorSchema.safeParse({ ...recurring, errorType: "vibes" })
        .success,
    ).toBe(false);
  });

  it("requires at least one occurrence, since a zero-count error is not an error", () => {
    expect(
      learnerErrorSchema.safeParse({ ...recurring, occurrenceCount: 0 })
        .success,
    ).toBe(false);
  });

  it("rejects a last-seen date preceding the first-seen date", () => {
    expect(
      learnerErrorSchema.safeParse({
        ...recurring,
        firstSeenAt: "2026-08-20T10:00:00.000Z",
        lastSeenAt: "2026-07-01T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("caps stored examples so an error record cannot grow without bound", () => {
    expect(
      learnerErrorSchema.safeParse({
        ...recurring,
        exampleUtterances: Array.from({ length: 100 }, (_, i) => `example ${i}`),
      }).success,
    ).toBe(false);
  });
});
