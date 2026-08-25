import { MAX_MESSAGE_LENGTH } from "@/domain/conversation";
import type { Scenario } from "@/domain/scenario";

/**
 * The opening move of a scenario practice session.
 *
 * Assembled from the scenario's own data and shown to the learner as the
 * tutor's first message, so the practice needs no hidden instruction: the
 * tutor receives it as ordinary conversation history, in the same untrusted
 * channel every message travels in, and honours it the way a model honours
 * its own stated plan. The learner sees exactly what the tutor was given.
 *
 * The frame is English and the scene is German, on the product's standing
 * rule: instructions are explanation, and explanation is given in the
 * language the learner already reads. An A1 learner handed the ground rules
 * in German has to decode the rules before they can follow them.
 *
 * The client pins this message into every turn's history window, so the
 * scene — or the passage — is still in front of the tutor when the
 * conversation has moved past the window's length.
 */

export interface RoleplaySeedMessage {
  readonly id: string;
  readonly role: "assistant";
  readonly content: string;
}

/**
 * A dialogue opened as a roleplay.
 *
 * The roles are dealt at random — playing the same side of every scene means
 * never learning the other half of it — and the deal is offered, not imposed:
 * the seed tells the learner they can swap by saying so, and the tutor
 * honours that from its own message. When the learner's role opens the
 * script, they get the first move.
 *
 * `chance` is injectable so a test can deal both hands deliberately.
 */
export function roleplaySeed(
  scenario: Scenario,
  chance: () => number = Math.random,
): RoleplaySeedMessage | null {
  if (scenario.type !== "dialogue") return null;

  const lines = scenario.content.lines;
  const first = lines[0];
  if (!first) return null;

  const other =
    lines.find((line) => line.speaker !== first.speaker)?.speaker ??
    "die andere Rolle";

  const tutorOpens = chance() < 0.5;
  const tutorRole = tutorOpens ? first.speaker : other;
  const learnerRole = tutorOpens ? other : first.speaker;

  const opening = tutorOpens
    ? [
        "Ich fange an:",
        "",
        first.german,
        first.english ? `(${first.english})` : null,
      ]
    : [`You start — you are ${learnerRole}. Was sagst du?`];

  const content = [
    `Rollenspiel: „${scenario.title}“ (${scenario.titleEnglish}).`,
    scenario.content.setting || null,
    "",
    `I'll play ${tutorRole} — you play ${learnerRole}. If you'd rather play ${tutorRole}, just say so and we start over with the roles swapped.`,
    "We stay in the scene. Stuck? Ask me and I'll suggest what you could say. If something goes wrong I'll correct it briefly and we play on.",
    "",
    ...opening,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  return {
    id: `scenario:${scenario.slug}`,
    role: "assistant",
    content,
  };
}

/**
 * How much of a passage the seed may carry.
 *
 * The seed travels as one chat message, under the same ceiling as anything
 * else said in a conversation. Every passage in the corpus fits with room to
 * spare (the longest is ~700 characters); the slice is a guard against a
 * future passage that would otherwise make the thread unopenable, and it
 * says so when it cuts.
 */
const PASSAGE_BUDGET = MAX_MESSAGE_LENGTH - 600;

/**
 * A comprehension opened as a conversation.
 *
 * The whole passage first, because reading it is the exercise. Then the
 * contract, in the tutor's own voice: say what you understood, take the
 * questions one at a time, wrong answers get an English explanation, and
 * getting most of it right ends the exercise with a told-you-so of the good
 * kind — you understood this, go practise something new. The questions
 * themselves are not in the seed: they would sit on screen above the
 * conversation, and a quiz the learner can read ahead of is not a quiz.
 */
export function comprehensionSeed(scenario: Scenario): RoleplaySeedMessage | null {
  if (scenario.type !== "comprehension") return null;

  const passage = scenario.content.passage;
  const shown =
    passage.length > PASSAGE_BUDGET
      ? `${passage.slice(0, PASSAGE_BUDGET)}… [gekürzt]`
      : passage;

  const content = [
    `Leseverstehen: „${scenario.title}“ (${scenario.titleEnglish}).`,
    "",
    "Read this:",
    "",
    shown,
    "",
    "When you have read it, tell me in your own words — in German — what it is about. Then I'll ask you a few questions about the text, one at a time. If an answer is off, I'll explain in English what the text actually says.",
    "Once you have most of it right — about three answers in four — you have understood this text: I'll say so, and you should pick something new to practise.",
  ].join("\n");

  return {
    id: `scenario:${scenario.slug}`,
    role: "assistant",
    content,
  };
}

/** The seed for whichever kind of scenario this is. */
export function scenarioSeed(
  scenario: Scenario,
  chance: () => number = Math.random,
): RoleplaySeedMessage | null {
  return scenario.type === "dialogue"
    ? roleplaySeed(scenario, chance)
    : comprehensionSeed(scenario);
}
