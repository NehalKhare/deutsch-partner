import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_LENGTH } from "@dp/domain/conversation";
import type { Scenario } from "@dp/domain/scenario";
import { comprehensionSeed, roleplaySeed, scenarioSeed } from "@/lib/scenarios/roleplay";

const DIALOGUE: Scenario = {
  id: 1,
  slug: "dialogue-a1-im-restaurant",
  type: "dialogue",
  kind: "dialogue",
  title: "Im Restaurant",
  titleEnglish: "At the Restaurant",
  description: "A customer orders lunch.",
  targetLevel: "A1",
  source: "Conversational_German_15_Dialogue_Stories.md",
  itemIndex: 0,
  content: {
    setting: "A customer orders lunch and pays at a small German restaurant.",
    lines: [
      { speaker: "Anna", german: "Guten Tag! Ich möchte eine Suppe, bitte.", english: "Hello! I would like a soup, please." },
      { speaker: "Kellner", german: "Natürlich.", english: "Of course." },
    ],
  },
  vocabulary: [],
};

const COMPREHENSION: Scenario = {
  id: 2,
  slug: "comprehension-a1-reading-ein-neuer-morgen",
  type: "comprehension",
  kind: "reading",
  title: "Ein neuer Morgen",
  titleEnglish: "A New Morning",
  description: "A reading passage.",
  targetLevel: "A1",
  source: "German_Listening_and_Comprehension_Practice.md",
  itemIndex: 20,
  content: {
    passage: "Anna steht auf.",
    passageEnglish: null,
    questions: [{ question: "Wann?", answer: "Um sieben." }],
  },
  vocabulary: [],
};

/** Deals the tutor the script's opening role, or the other one. */
const tutorOpens = () => 0;
const learnerOpens = () => 0.9;

describe("the roleplay opening", () => {
  it("frames the scene and delivers the script's first line when the tutor opens", () => {
    const seed = roleplaySeed(DIALOGUE, tutorOpens);

    expect(seed).not.toBeNull();
    expect(seed?.role).toBe("assistant");
    expect(seed?.content).toContain("Im Restaurant");
    expect(seed?.content).toContain("At the Restaurant");
    expect(seed?.content).toContain("Guten Tag! Ich möchte eine Suppe, bitte.");
    // Both roles are named, so the learner knows who speaks next.
    expect(seed?.content).toContain("I'll play Anna");
    expect(seed?.content).toContain("you play Kellner");
  });

  it("gives the learner the first move when the deal goes the other way", () => {
    const seed = roleplaySeed(DIALOGUE, learnerOpens);

    expect(seed?.content).toContain("I'll play Kellner");
    expect(seed?.content).toContain("you play Anna");
    expect(seed?.content).toContain("You start");
    // The script's first line belongs to the learner's role now; delivering
    // it would play their part for them.
    expect(seed?.content).not.toContain("Guten Tag! Ich möchte eine Suppe, bitte.");
  });

  it("offers the swap, in words the tutor then has to honour", () => {
    // The deal is random, so the offer is the learner's control over it —
    // "I want to be X" has to be a thing the seed already promised works.
    for (const chance of [tutorOpens, learnerOpens]) {
      const seed = roleplaySeed(DIALOGUE, chance);
      expect(seed?.content).toContain("If you'd rather play");
      expect(seed?.content).toContain("roles swapped");
    }
  });

  it("promises suggestions and corrections, so the learner knows to ask", () => {
    const seed = roleplaySeed(DIALOGUE, tutorOpens);

    expect(seed?.content).toContain("I'll suggest what you could say");
    expect(seed?.content).toContain("correct it briefly");
  });

  it("fits inside a chat message, because it travels as one", () => {
    for (const chance of [tutorOpens, learnerOpens]) {
      const seed = roleplaySeed(DIALOGUE, chance);
      expect(seed?.content.length ?? 0).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it("has a stable id keyed to the scenario", () => {
    expect(roleplaySeed(DIALOGUE)?.id).toBe("scenario:dialogue-a1-im-restaurant");
  });

  it("declines a comprehension: there is nothing to roleplay", () => {
    expect(roleplaySeed(COMPREHENSION)).toBeNull();
  });
});

describe("the comprehension opening", () => {
  it("carries the whole passage, because reading it is the exercise", () => {
    const seed = comprehensionSeed(COMPREHENSION);

    expect(seed).not.toBeNull();
    expect(seed?.role).toBe("assistant");
    expect(seed?.content).toContain("Ein neuer Morgen");
    expect(seed?.content).toContain("A New Morning");
    expect(seed?.content).toContain("Anna steht auf.");
  });

  it("states the contract: retell, questions one at a time, English explanations", () => {
    const seed = comprehensionSeed(COMPREHENSION);

    expect(seed?.content).toContain("in your own words");
    expect(seed?.content).toContain("one at a time");
    expect(seed?.content).toContain("explain in English");
  });

  it("names the finish line: mostly right means done, go practise something new", () => {
    const seed = comprehensionSeed(COMPREHENSION);

    expect(seed?.content).toContain("three answers in four");
    expect(seed?.content).toContain("something new to practise");
  });

  it("does not carry the curated answers, which would spoil the quiz", () => {
    expect(comprehensionSeed(COMPREHENSION)?.content).not.toContain("Um sieben.");
  });

  it("caps a runaway passage instead of making the thread unopenable", () => {
    const long = {
      ...COMPREHENSION,
      content: { ...COMPREHENSION.content, passage: "a".repeat(7999) },
    } as typeof COMPREHENSION;

    const seed = comprehensionSeed(long);

    expect(seed?.content.length ?? 0).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    expect(seed?.content).toContain("[gekürzt]");
  });

  it("declines a dialogue: there is nothing to read", () => {
    expect(comprehensionSeed(DIALOGUE)).toBeNull();
  });

  it("has a stable id keyed to the scenario", () => {
    expect(comprehensionSeed(COMPREHENSION)?.id).toBe(
      "scenario:comprehension-a1-reading-ein-neuer-morgen",
    );
  });
});

describe("the dispatcher", () => {
  it("routes each kind to its own opening", () => {
    expect(scenarioSeed(DIALOGUE, tutorOpens)?.content).toContain("Rollenspiel");
    expect(scenarioSeed(COMPREHENSION)?.content).toContain("Leseverstehen");
  });
});
