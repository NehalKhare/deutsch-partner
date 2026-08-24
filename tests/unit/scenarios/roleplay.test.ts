import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_LENGTH } from "@/domain/conversation";
import type { Scenario } from "@/domain/scenario";
import { roleplaySeed } from "@/lib/scenarios/roleplay";

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

describe("the roleplay opening", () => {
  it("frames the scene and delivers the script's first line", () => {
    const seed = roleplaySeed(DIALOGUE);

    expect(seed).not.toBeNull();
    expect(seed?.role).toBe("assistant");
    expect(seed?.content).toContain("Im Restaurant");
    expect(seed?.content).toContain("At the Restaurant");
    expect(seed?.content).toContain("Guten Tag! Ich möchte eine Suppe, bitte.");
    // Both roles are named, so the learner knows who speaks next.
    expect(seed?.content).toContain("Anna");
    expect(seed?.content).toContain("Kellner");
  });

  it("fits inside a chat message, because it travels as one", () => {
    const seed = roleplaySeed(DIALOGUE);
    expect(seed?.content.length ?? 0).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  });

  it("has a stable id keyed to the scenario", () => {
    expect(roleplaySeed(DIALOGUE)?.id).toBe("scenario:dialogue-a1-im-restaurant");
  });

  it("declines a comprehension: there is nothing to roleplay", () => {
    expect(roleplaySeed(COMPREHENSION)).toBeNull();
  });
});
