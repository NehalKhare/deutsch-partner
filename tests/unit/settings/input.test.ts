import { describe, expect, it } from "vitest";

import { CORRECTION_PREFERENCES } from "@/domain/learner";
import {
  CORRECTION_PREFERENCE_OPTIONS,
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
} from "@/lib/onboarding/defaults";
import { parseSettingsForm, settingsInputSchema } from "@/lib/settings/input";

/**
 * The settings form's boundary.
 *
 * These values become prompt content and retrieval filters on every turn, so
 * the schema is a closed set with caps — free text here would be unbounded
 * values reaching both.
 */

function form(over: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  const defaults: Record<string, string | string[]> = {
    nativeLanguage: "en",
    learningGoal: "Order food in Vienna",
    targetTopics: ["travel"],
    interests: ["cooking"],
    inputPreference: "text",
    outputPreference: "text",
    correctionPreference: "gentle",
    voicePreference: "male",
  };

  for (const [key, value] of Object.entries({ ...defaults, ...over })) {
    if (Array.isArray(value)) for (const entry of value) data.append(key, entry);
    else data.set(key, value);
  }
  return data;
}

describe("what the form accepts", () => {
  it("accepts a complete submission", () => {
    const parsed = parseSettingsForm(form());

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.correctionPreference).toBe("gentle");
  });

  it("treats no boxes ticked as an empty selection, not a missing field", () => {
    const parsed = parseSettingsForm(form({ targetTopics: [], interests: [] }));

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.targetTopics).toEqual([]);
  });

  it("has no way to submit a level", () => {
    // The level is position and moves on the curriculum page. A settings form
    // that could relocate the syllabus would be the wrong kind of surprise.
    expect(Object.keys(settingsInputSchema.shape)).not.toContain("selectedLevel");
  });

  it("has no way to say who you are", () => {
    expect(Object.keys(settingsInputSchema.shape)).not.toContain("id");
  });
});

describe("what the form refuses", () => {
  it("names the cap when too many topics arrive", () => {
    const over = Array.from({ length: MAX_SELECTED_TOPICS + 1 }, (_, i) =>
      ["travel", "daily_life", "work", "food", "hobbies", "study"][i]!,
    );

    const parsed = parseSettingsForm(form({ targetTopics: over }));

    expect(parsed).toMatchObject({
      success: false,
      message: expect.stringContaining(String(MAX_SELECTED_TOPICS)),
    });
  });

  it("names the cap when too many interests arrive", () => {
    const over = ["cycling", "football", "cooking", "music", "films", "reading"];

    const parsed = parseSettingsForm(form({ interests: over }));

    expect(parsed).toMatchObject({
      success: false,
      message: expect.stringContaining(String(MAX_SELECTED_INTERESTS)),
    });
  });

  it("refuses a topic outside the closed set", () => {
    expect(parseSettingsForm(form({ targetTopics: ["hacking"] })).success).toBe(
      false,
    );
  });

  it("refuses the same topic twice", () => {
    expect(
      parseSettingsForm(form({ targetTopics: ["travel", "travel"] })).success,
    ).toBe(false);
  });

  it("refuses an empty goal, naming the field", () => {
    const parsed = parseSettingsForm(form({ learningGoal: "   " }));

    expect(parsed).toMatchObject({
      success: false,
      message: expect.stringContaining("learning goal"),
    });
  });

  it("refuses a correction style the product does not have", () => {
    expect(
      parseSettingsForm(form({ correctionPreference: "brutal" })).success,
    ).toBe(false);
  });

  it("refuses a voice the product does not have", () => {
    expect(parseSettingsForm(form({ voicePreference: "robot" })).success).toBe(
      false,
    );
  });
});

describe("keeping the option list honest", () => {
  it("offers exactly the correction styles the domain defines", () => {
    // The schema validates against the domain enum; the form renders the
    // option list. If they drift, a choice on screen becomes unsubmittable.
    expect(CORRECTION_PREFERENCE_OPTIONS.map((option) => option.value).sort()).toEqual(
      [...CORRECTION_PREFERENCES].sort(),
    );
  });
});
