import { describe, expect, it } from "vitest";
import { ACTIVITY_TYPES, recommendationSchema } from "../src/recommendation";

const recommendation = {
  id: "88888888-8888-4888-8888-888888888888",
  learnerId: "11111111-1111-4111-8111-111111111111",
  activityType: "conversation",
  mode: "roleplay",
  topic: "travel",
  reason: { kind: "review_due", dueCount: 12 },
  score: 0.82,
  createdAt: "2026-08-20T10:00:00.000Z",
  expiresAt: "2026-08-21T10:00:00.000Z",
};

describe("recommendationSchema", () => {
  it("accepts a valid recommendation", () => {
    expect(recommendationSchema.parse(recommendation).score).toBe(0.82);
  });

  it("offers a diverse set of activity types", () => {
    expect(ACTIVITY_TYPES.length).toBeGreaterThanOrEqual(4);
    expect(ACTIVITY_TYPES).toContain("conversation");
    expect(ACTIVITY_TYPES).toContain("review");
  });

  it.each([
    [{ kind: "review_due", dueCount: 12 }],
    [{ kind: "weakness", errorType: "word_order" }],
    [{ kind: "interest", interest: "cycling" }],
    [{ kind: "level_progression", miniLevel: 21 }],
  ])("accepts reason %o", (reason) => {
    expect(recommendationSchema.parse({ ...recommendation, reason }).reason)
      .toEqual(reason);
  });

  it("rejects a reason outside the closed set, so ranking stays explainable", () => {
    expect(
      recommendationSchema.safeParse({
        ...recommendation,
        reason: { kind: "hunch" },
      }).success,
    ).toBe(false);
  });

  it("requires the payload that matches the reason kind", () => {
    expect(
      recommendationSchema.safeParse({
        ...recommendation,
        reason: { kind: "weakness" },
      }).success,
    ).toBe(false);
  });

  it("rejects a score outside the unit interval", () => {
    expect(
      recommendationSchema.safeParse({ ...recommendation, score: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects an expiry earlier than creation", () => {
    expect(
      recommendationSchema.safeParse({
        ...recommendation,
        expiresAt: "2026-08-19T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
