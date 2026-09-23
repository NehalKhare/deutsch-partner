import { describe, expect, it } from "vitest";

import {
  INTEREST_OPTIONS,
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
  TOPIC_OPTIONS,
} from "../src/onboarding/defaults";
import { onboardingInputSchema, parseOnboardingForm } from "../src/onboarding/input";

const valid = {
  learningGoal: "Hold a conversation on holiday in Berlin",
  selectedLevel: "A2",
  targetTopics: ["travel"],
  interests: ["cycling"],
  inputPreference: "text",
  outputPreference: "text",
  correctionPreference: "gentle",
};

describe("onboardingInputSchema", () => {
  it("accepts a complete submission", () => {
    expect(onboardingInputSchema.parse(valid).selectedLevel).toBe("A2");
  });

  it("has no learner id, because that comes from the session", () => {
    expect(Object.keys(onboardingInputSchema.shape)).not.toContain("id");
  });

  it("requires a learning goal", () => {
    expect(
      onboardingInputSchema.safeParse({ ...valid, learningGoal: "   " }).success,
    ).toBe(false);
  });

  it("rejects a level outside the product's path", () => {
    expect(
      onboardingInputSchema.safeParse({ ...valid, selectedLevel: "C1" }).success,
    ).toBe(false);
  });

  it("rejects a topic that is not on the offered list", () => {
    // Topics feed retrieval filters and prompts, so the set stays closed.
    expect(
      onboardingInputSchema.safeParse({ ...valid, targetTopics: ["hacking"] })
        .success,
    ).toBe(false);
  });

  it("rejects more topics than a learner may choose", () => {
    expect(
      onboardingInputSchema.safeParse({
        ...valid,
        targetTopics: Array.from({ length: MAX_SELECTED_TOPICS + 1 }, () => "travel"),
      }).success,
    ).toBe(false);
  });

  it("rejects the same topic listed twice", () => {
    expect(
      onboardingInputSchema.safeParse({
        ...valid,
        targetTopics: ["travel", "travel"],
      }).success,
    ).toBe(false);
  });

  it("accepts no topics at all", () => {
    expect(
      onboardingInputSchema.safeParse({ ...valid, targetTopics: [] }).success,
    ).toBe(true);
  });

  it("caps the learning goal, which is rendered into every prompt", () => {
    expect(
      onboardingInputSchema.safeParse({
        ...valid,
        learningGoal: "a".repeat(5000),
      }).success,
    ).toBe(false);
  });
});

describe("parseOnboardingForm", () => {
  function formData(entries: Array<[string, string]>) {
    const data = new FormData();
    for (const [key, value] of entries) data.append(key, value);
    return data;
  }

  it("collects repeated checkbox values into a list", () => {
    const result = parseOnboardingForm(
      formData([
        ["learningGoal", "Talk to my colleagues"],
        ["selectedLevel", "A1"],
        ["targetTopics", "travel"],
        ["targetTopics", "work"],
        ["inputPreference", "text"],
        ["outputPreference", "text"],
        ["correctionPreference", "gentle"],
      ]),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetTopics).toEqual(["travel", "work"]);
  });

  it("treats absent checkbox groups as empty rather than missing", () => {
    const result = parseOnboardingForm(
      formData([
        ["learningGoal", "Talk to my colleagues"],
        ["selectedLevel", "A1"],
        ["inputPreference", "text"],
        ["outputPreference", "text"],
        ["correctionPreference", "gentle"],
      ]),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.interests).toEqual([]);
  });

  it("reports a readable message for a missing goal", () => {
    const result = parseOnboardingForm(
      formData([
        ["learningGoal", ""],
        ["selectedLevel", "A1"],
        ["inputPreference", "text"],
        ["outputPreference", "text"],
        ["correctionPreference", "gentle"],
      ]),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message.toLowerCase()).toContain("goal");
  });

  it("rejects a forged level submitted outside the form", () => {
    const result = parseOnboardingForm(
      formData([
        ["learningGoal", "Talk to my colleagues"],
        ["selectedLevel", "C2"],
        ["inputPreference", "text"],
        ["outputPreference", "text"],
        ["correctionPreference", "gentle"],
      ]),
    );

    expect(result.success).toBe(false);
  });
});

describe("a list over its cap", () => {
  /** A submission that did not come from the form, since the form prevents it. */
  function overLimit(name: "targetTopics" | "interests", count: number): FormData {
    const data = new FormData();
    data.set("learningGoal", "Order coffee in Vienna");
    data.set("selectedLevel", "A1");
    data.set("inputPreference", "text");
    data.set("outputPreference", "text");
    data.set("correctionPreference", "gentle");

    const options = name === "targetTopics" ? TOPIC_OPTIONS : INTEREST_OPTIONS;
    for (const option of options.slice(0, count)) data.append(name, option.value);

    return data;
  }

  it("says how many topics are allowed, not merely that something is wrong", () => {
    const result = parseOnboardingForm(overLimit("targetTopics", MAX_SELECTED_TOPICS + 1));

    expect(result.success).toBe(false);
    expect(result.success === false && result.message).toBe(
      `Please choose at most ${MAX_SELECTED_TOPICS} topics.`,
    );
  });

  it("says how many interests are allowed", () => {
    const result = parseOnboardingForm(
      overLimit("interests", MAX_SELECTED_INTERESTS + 1),
    );

    expect(result.success === false && result.message).toBe(
      `Please choose at most ${MAX_SELECTED_INTERESTS} interests.`,
    );
  });

  it("accepts exactly the limit", () => {
    expect(parseOnboardingForm(overLimit("targetTopics", MAX_SELECTED_TOPICS)).success).toBe(
      true,
    );
  });

  it("does not blame the limit for a topic that is simply not on the list", () => {
    // Only a too-big list gets the limit message. A value that was never an
    // option is a different problem, and saying "at most 5" would misdirect.
    const data = overLimit("targetTopics", 1);
    data.append("targetTopics", "underwater-basket-weaving");

    const result = parseOnboardingForm(data);
    expect(result.success).toBe(false);
    expect(result.success === false && result.message).not.toMatch(/at most/i);
  });

  it("still gives the general message for anything else", () => {
    const data = overLimit("targetTopics", 1);
    data.set("learningGoal", "");

    const result = parseOnboardingForm(data);
    expect(result.success === false && result.message).toMatch(/learning goal/i);
  });
});
