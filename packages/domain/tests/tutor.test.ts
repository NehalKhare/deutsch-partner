import { describe, expect, it } from "vitest";

import {
  TUTOR,
  TUTOR_PERSONAS,
  VOICE_GENDERS,
  tutorFor,
} from "../src/tutor";

describe("the tutor's persona", () => {
  it("is Jonas, a man, until the learner chooses otherwise", () => {
    expect(TUTOR).toEqual({ name: "Jonas", voice: "male" });
    expect(tutorFor("male")).toBe(TUTOR);
  });

  it("becomes Alex, a woman, when the learner chooses the female voice", () => {
    expect(tutorFor("female")).toEqual({ name: "Alex", voice: "female" });
  });

  it("has a persona for every voice a learner can choose", () => {
    // The settings page offers exactly these; a voice without a person behind
    // it would be a name the prompt cannot fill in.
    for (const voice of VOICE_GENDERS) {
      expect(tutorFor(voice).voice).toBe(voice);
      expect(tutorFor(voice).name.length).toBeGreaterThan(0);
    }
  });

  it("gives the two personas different names, since they are different people", () => {
    const names = new Set(Object.values(TUTOR_PERSONAS).map((persona) => persona.name));

    expect(names.size).toBe(VOICE_GENDERS.length);
  });
});
