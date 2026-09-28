import { describe, expect, it } from "vitest";

import { TUTOR, tutorFor } from "@dp/domain/tutor";
import {
  behaviorPolicyFor,
  buildIdentityBlock,
  buildPrompt,
  promptEntry,
} from "../src/index";

/**
 * The tutor the prompt describes is the one the learner chose.
 *
 * A learner who picks the female voice hears Alex and must read Alex too: a
 * reply signed Jonas in a woman's voice is two people, and the persona is
 * only worth having if all three layers agree on it.
 */

const LEARNER = {
  effectiveLevel: { cefr: "A2" as const, plus: false },
  miniLevel: 26,
  theme: "Reisen",
  focus: "getting around",
  learningGoal: "Talk to colleagues in German",
  interests: ["travel"],
  targetVocabulary: ["der Zug"],
  targetGrammar: ["the dative case"],
  dueVocabulary: [],
  recurringErrors: [],
  justMoved: null,
};

function systemFor(tutorVoice?: "male" | "female"): string {
  const built = buildPrompt(promptEntry("conversation.turn"), {
    policy: behaviorPolicyFor({ cefr: "A2" }),
    cefr: "A2",
    learner: LEARNER,
    userMessage: "Wie heißt du?",
    ...(tutorVoice ? { tutorVoice } : {}),
  });

  if (!built.ok) throw new Error(built.detail);

  return built.prompt.system;
}

describe("the identity block", () => {
  it("names Jonas, a man, for the male voice", () => {
    const identity = buildIdentityBlock("learner_facing", tutorFor("male"));

    expect(identity).toContain("You are Jonas");
    expect(identity).toContain("Your name is Jonas");
    expect(identity).toContain("You are a man");
    expect(identity).toContain("Lehrer, Partner");
    expect(identity).not.toContain("Alex");
  });

  it("names Alex, a woman, for the female voice", () => {
    const identity = buildIdentityBlock("learner_facing", tutorFor("female"));

    expect(identity).toContain("You are Alex");
    expect(identity).toContain("Your name is Alex");
    expect(identity).toContain("You are a woman");
    expect(identity).toContain("Lehrerin, Partnerin");
    expect(identity).not.toContain("Jonas");
  });

  it("is the shipped persona when nobody says otherwise", () => {
    expect(buildIdentityBlock()).toBe(buildIdentityBlock("learner_facing", TUTOR));
  });

  it("gives a machine component no persona at all", () => {
    const machine = buildIdentityBlock("machine", tutorFor("female"));

    expect(machine).not.toContain("Alex");
    expect(machine).not.toContain("Jonas");
    expect(machine).toBe(buildIdentityBlock("machine"));
  });
});

describe("a built conversation prompt", () => {
  it("defaults to Jonas, so a profile from before the choice existed is unchanged", () => {
    expect(systemFor()).toBe(systemFor("male"));
    expect(systemFor()).toContain("You are Jonas");
  });

  it("tells the model it is Alex when the learner chose the female voice", () => {
    const system = systemFor("female");

    expect(system).toContain("You are Alex");
    expect(system).not.toContain("Jonas");
  });

  it("refuses a voice the settings page does not offer", () => {
    const built = buildPrompt(promptEntry("conversation.turn"), {
      policy: behaviorPolicyFor({ cefr: "A2" }),
      cefr: "A2",
      learner: LEARNER,
      userMessage: "Hallo",
      // Deliberately outside the closed set.
      tutorVoice: "robot" as unknown as "male",
    });

    expect(built).toMatchObject({ ok: false, reason: "invalid_input" });
  });
});
