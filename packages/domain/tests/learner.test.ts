import { describe, expect, it } from "vitest";
import {
  TRAINER_PERSONALITIES,
  deriveEffectiveLevel,
  learnerProfileSchema,
  learnerStateSchema,
} from "../src/learner";

const validProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  nativeLanguage: "en",
  learningGoal: "Hold a conversation on holiday in Berlin",
  selectedLevel: "A2",
  targetTopics: ["travel", "food"],
  interests: ["cycling"],
  inputPreference: "text",
  outputPreference: "text",
  correctionPreference: "gentle",
} as const;

describe("learnerProfileSchema", () => {
  it("accepts a complete profile", () => {
    expect(learnerProfileSchema.parse(validProfile).selectedLevel).toBe("A2");
  });

  it("rejects an invalid CEFR selection", () => {
    expect(
      learnerProfileSchema.safeParse({ ...validProfile, selectedLevel: "C1" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-uuid id, so a client cannot pass an arbitrary key", () => {
    expect(
      learnerProfileSchema.safeParse({ ...validProfile, id: "me" }).success,
    ).toBe(false);
  });

  it("rejects unknown properties rather than silently dropping them", () => {
    expect(
      learnerProfileSchema.safeParse({ ...validProfile, isAdmin: true }).success,
    ).toBe(false);
  });

  it.each(["gentle", "explicit", "minimal"])(
    "accepts correction preference %s",
    (correctionPreference) => {
      expect(
        learnerProfileSchema.parse({ ...validProfile, correctionPreference })
          .correctionPreference,
      ).toBe(correctionPreference);
    },
  );

  describe("the trainer's personality", () => {
    it("is friendly for a profile from before the column existed", () => {
      // A learner who has not chosen is a learner with the trainer as shipped.
      expect(learnerProfileSchema.parse(validProfile).trainerPersonality).toBe("friendly");
    });

    it.each(TRAINER_PERSONALITIES)("accepts %s", (trainerPersonality) => {
      expect(
        learnerProfileSchema.parse({ ...validProfile, trainerPersonality })
          .trainerPersonality,
      ).toBe(trainerPersonality);
    });

    it("refuses a personality the product does not offer", () => {
      expect(
        learnerProfileSchema.safeParse({ ...validProfile, trainerPersonality: "sarcastic" })
          .success,
      ).toBe(false);
    });
  });
});

describe("deriveEffectiveLevel", () => {
  it("follows the evidence, not the learner's aspiration", () => {
    const effective = deriveEffectiveLevel({
      selectedLevel: "B1",
      estimatedLevel: "A2",
      confidence: 0.9,
    });

    expect(effective.cefr).toBe("A2");
  });

  it("never mutates or overrides the learner's selection", () => {
    const input = {
      selectedLevel: "B1",
      estimatedLevel: "A2",
      confidence: 0.9,
    } as const;

    deriveEffectiveLevel(input);

    expect(input.selectedLevel).toBe("B1");
  });

  it("awards a plus when the estimate is held with high confidence", () => {
    expect(
      deriveEffectiveLevel({
        selectedLevel: "A2",
        estimatedLevel: "A2",
        confidence: 0.95,
      }),
    ).toEqual({ cefr: "A2", plus: true });
  });

  it("withholds the plus while confidence is still low", () => {
    expect(
      deriveEffectiveLevel({
        selectedLevel: "A2",
        estimatedLevel: "A2",
        confidence: 0.3,
      }),
    ).toEqual({ cefr: "A2", plus: false });
  });

  it("never awards a plus at B1, which would imply B2", () => {
    expect(
      deriveEffectiveLevel({
        selectedLevel: "B1",
        estimatedLevel: "B1",
        confidence: 1,
      }),
    ).toEqual({ cefr: "B1", plus: false });
  });

  it("falls back to the selection before any evidence exists", () => {
    expect(
      deriveEffectiveLevel({ selectedLevel: "A1", estimatedLevel: null, confidence: 0 }),
    ).toEqual({ cefr: "A1", plus: false });
  });
});

describe("learnerStateSchema", () => {
  const validState = {
    learnerId: "11111111-1111-4111-8111-111111111111",
    selectedLevel: "B1",
    estimatedLevel: "A2",
    effectiveLevel: { cefr: "A2", plus: true },
    miniLevel: 20,
    furthestMiniLevel: 20,
    skippedMiniLevels: [],
    fluency: 0.4,
    comprehension: 0.6,
    confidence: 0.5,
    updatedAt: "2026-08-21T10:00:00.000Z",
  };

  it("accepts a valid state and normalises the timestamp to a Date", () => {
    expect(learnerStateSchema.parse(validState).updatedAt).toBeInstanceOf(Date);
  });

  it("keeps selected, estimated and effective level as three distinct fields", () => {
    const state = learnerStateSchema.parse(validState);

    expect(state.selectedLevel).toBe("B1");
    expect(state.estimatedLevel).toBe("A2");
    expect(state.effectiveLevel).toEqual({ cefr: "A2", plus: true });
  });

  it("allows an absent estimate before the learner has been assessed", () => {
    expect(
      learnerStateSchema.parse({ ...validState, estimatedLevel: null })
        .estimatedLevel,
    ).toBeNull();
  });

  it.each(["fluency", "comprehension", "confidence"])(
    "rejects %s outside the unit interval",
    (field) => {
      expect(
        learnerStateSchema.safeParse({ ...validState, [field]: 1.2 }).success,
      ).toBe(false);
    },
  );

  it("rejects a mini-level inconsistent with the effective level", () => {
    // Mini-level 60 is B1 territory; an A2 effective level contradicts it.
    expect(
      learnerStateSchema.safeParse({ ...validState, miniLevel: 60 }).success,
    ).toBe(false);
  });
});
