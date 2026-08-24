import { describe, expect, it } from "vitest";

import {
  CORRECTION_PREFERENCE_OPTIONS,
  INTEREST_OPTIONS,
  MAX_SELECTED_TOPICS,
  NATIVE_LANGUAGE_OPTIONS,
  TOPIC_OPTIONS,
  defaultOnboardingDraft,
  initialLearnerState,
} from "@/lib/onboarding/defaults";
import { learnerStateSchema } from "@/domain/learner";
import { onboardingInputSchema } from "@/lib/onboarding/input";

describe("defaultOnboardingDraft", () => {
  it("starts a beginner at A1, which is the safe assumption", () => {
    expect(defaultOnboardingDraft().selectedLevel).toBe("A1");
  });

  it("defaults to text in and text out, the mode that always works", () => {
    // Voice needs a microphone permission the learner has not granted yet.
    expect(defaultOnboardingDraft()).toMatchObject({
      inputPreference: "text",
      outputPreference: "text",
    });
  });

  it("defaults to gentle correction", () => {
    expect(defaultOnboardingDraft().correctionPreference).toBe("gentle");
  });

  it("selects nothing on the learner's behalf", () => {
    const draft = defaultOnboardingDraft();

    expect(draft.targetTopics).toEqual([]);
    expect(draft.interests).toEqual([]);
  });

  it("returns a fresh object each time, not a shared one", () => {
    const first = defaultOnboardingDraft();
    first.targetTopics.push("travel");

    expect(defaultOnboardingDraft().targetTopics).toEqual([]);
  });

  it("is not a valid submission on its own", () => {
    // The learning goal is the one thing only the learner can supply.
    expect(onboardingInputSchema.safeParse(defaultOnboardingDraft()).success)
      .toBe(false);
  });
});

describe("option lists", () => {
  it.each([
    ["topics", TOPIC_OPTIONS],
    ["interests", INTEREST_OPTIONS],
    ["native languages", NATIVE_LANGUAGE_OPTIONS],
    ["correction preferences", CORRECTION_PREFERENCE_OPTIONS],
  ])("offers a usable set of %s", (_label, options) => {
    expect(options.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["topics", TOPIC_OPTIONS],
    ["interests", INTEREST_OPTIONS],
  ])("has no duplicate %s values", (_label, options) => {
    const values = options.map((option) => option.value);

    expect(new Set(values).size).toBe(values.length);
  });

  it("gives every option a human label, not just a value", () => {
    for (const option of [...TOPIC_OPTIONS, ...INTEREST_OPTIONS]) {
      expect(option.label).not.toBe(option.value);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps topic values within the length the database accepts", () => {
    for (const option of TOPIC_OPTIONS) {
      expect(option.value.length).toBeLessThanOrEqual(64);
    }
  });

  it("caps how many topics a learner can pick", () => {
    // An unbounded list becomes prompt tokens on every single turn.
    expect(MAX_SELECTED_TOPICS).toBeLessThanOrEqual(5);
  });
});

describe("initialLearnerState", () => {
  const learnerId = "11111111-1111-4111-8111-111111111111";

  it("starts every learner at mini-level one", () => {
    expect(initialLearnerState(learnerId, "B1").miniLevel).toBe(1);
  });

  it("records the chosen level as a preference without acting on it", () => {
    const state = initialLearnerState(learnerId, "B1");

    expect(state.selectedLevel).toBe("B1");
    expect(state.effectiveLevel).toEqual({ cefr: "A1", plus: false });
  });

  it("has no estimate before the learner has been assessed", () => {
    expect(initialLearnerState(learnerId, "A2").estimatedLevel).toBeNull();
  });

  it("starts every skill estimate at zero", () => {
    const state = initialLearnerState(learnerId, "A1");

    expect(state).toMatchObject({ fluency: 0, comprehension: 0, confidence: 0 });
  });

  it("produces a state the domain accepts", () => {
    expect(
      learnerStateSchema.safeParse(initialLearnerState(learnerId, "B1")).success,
    ).toBe(true);
  });
});
