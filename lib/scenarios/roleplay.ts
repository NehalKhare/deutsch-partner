import type { Scenario } from "@/domain/scenario";

/**
 * The opening move of a dialogue practice session.
 *
 * Assembled from the scenario's own data and shown to the learner as the
 * partner's first message, so the roleplay needs no hidden instruction: the
 * tutor receives it as ordinary conversation history, in the same untrusted
 * channel every message travels in, and continues the scene from there. The
 * partner takes the script's opening role and delivers its first line; the
 * learner answers as the other speaker.
 */

export interface RoleplaySeedMessage {
  readonly id: string;
  readonly role: "assistant";
  readonly content: string;
}

export function roleplaySeed(scenario: Scenario): RoleplaySeedMessage | null {
  if (scenario.type !== "dialogue") return null;

  const lines = scenario.content.lines;
  const first = lines[0];
  if (!first) return null;

  const partner =
    lines.find((line) => line.speaker !== first.speaker)?.speaker ??
    "die andere Rolle";

  const opening = [
    `Rollenspiel: „${scenario.title}“ (${scenario.titleEnglish}).`,
    scenario.content.setting,
    `Ich spiele ${first.speaker}, du spielst ${partner}. Ich fange an:`,
    "",
    first.german,
    first.english ? `(${first.english})` : "",
    "",
    "Jetzt du!",
  ]
    .filter((part, index) => part !== "" || index === 3 || index === 6)
    .join("\n");

  return {
    id: `scenario:${scenario.slug}`,
    role: "assistant",
    content: opening,
  };
}
