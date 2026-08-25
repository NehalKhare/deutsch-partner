import { describe, expect, it } from "vitest";

import { CEFR_LEVELS } from "@/domain/cefr";
import {
  TRAINER_PROMPT_NAME,
  TRAINER_PROMPT_VERSION,
  trainerSystemPrompt,
} from "@/lib/ai/prompts/trainer";
import {
  PROMPT_CATALOGUE,
  behaviorPolicyFor,
  buildOutputContract,
  buildPrompt,
  fingerprint,
  versionedText as blockText,
  type PromptCatalogEntry,
} from "@/lib/ai/prompts";

/** Enough learner context for any entry to build; only some entries render it. */
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

/**
 * The version lock.
 *
 * A prompt is immutable once shipped. Editing the wording changes behaviour,
 * and a trace or a ledger row that says version 1 has to still mean the same
 * version 1 next month. So the text is fingerprinted and the fingerprint is
 * recorded here against the version.
 *
 * If this test fails you have edited a prompt. That is fine, and the fix is
 * one of two deliberate acts:
 *
 *   - a wording change with no behavioural effect: update the hash below
 *   - anything else: bump the entry's version, then add the new hash
 *
 * What it must never be is an unnoticed edit.
 */
const RECORDED: Readonly<Record<string, string>> = {
  // Version 4: the learner's goal is rendered as quoted, bracket-escaped data
  // — the settings page made it editable at will, and free text in the
  // trusted zone is an injection point. (Version 3 greeted an earned move
  // differently from an asked-for one; version 2 gave the tutor his name.)
  // Both changes live in the learner-state block, which is caller data, so
  // the fingerprints — a promise about the entry's own blocks — are inherited
  // unchanged. That is exactly why the versions had to move by hand: these
  // are behaviour changes the lock cannot see.
  "conversation.turn@4/A1": "12c321c1",
  "conversation.turn@4/A2": "bfee4f9c",
  "conversation.turn@4/B1": "621d4551",
  "conversation.repair@4/A1": "12c321c1",
  "conversation.repair@4/A2": "bfee4f9c",
  "conversation.repair@4/B1": "621d4551",
  // Version 4: the contract fixes the explanation's form, not just its
  // language — English prose quoting the German and naming the correct form,
  // because that one sentence is all the dashboard shows.
  "evaluation.learner_message@4": "115d51cb",
  "extraction.errors@2": "07d19adb",
  "extraction.memory@2": "64dd8afe",
  "summarization.thread@2": "b9388353",
  "classification.intent@2": "34b3ed0b",
  "classification.safety_screen@2": "74efe76c",
};

/**
 * The text a version is a promise about.
 *
 * Built the way production builds it and then filtered to the blocks that come
 * from the entry rather than from a caller's data — which is the same function
 * the gateway records a fingerprint with. Two definitions of "the versioned
 * text" is exactly the drift this lock exists to catch.
 *
 * For a machine entry that includes its output contract, generated from the
 * schema that validates the reply. Without it the lock would cover only the
 * three shared prefix blocks, and every extractor in the catalogue would share
 * one fingerprint — so tightening a field cap or adding an enum member would
 * change what a model is asked for and change no hash.
 */
function versionedText(entry: PromptCatalogEntry, level?: "A1" | "A2" | "B1"): string {
  const cefr = level ?? "A2";
  const built = buildPrompt(entry, {
    policy: behaviorPolicyFor({ cefr }),
    cefr,
    learner: LEARNER,
    userMessage: "Ich fahre morgen nach Berlin.",
  });

  if (!built.ok) throw new Error(`${entry.name} did not build: ${built.detail}`);

  return blockText(built.prompt);
}

function keysFor(entry: PromptCatalogEntry): Array<[string, string]> {
  if (entry.register === "machine") {
    return [[`${entry.name}@${entry.version}`, versionedText(entry)]];
  }

  return CEFR_LEVELS.map((level) => [
    `${entry.name}@${entry.version}/${level}`,
    versionedText(entry, level),
  ]);
}

describe("prompt versions are locked to their text", () => {
  const recorded = Object.entries(
    Object.fromEntries(PROMPT_CATALOGUE.flatMap((entry) => keysFor(entry))),
  );

  it("records a fingerprint for every shipped version", () => {
    const missing = recorded.map(([key]) => key).filter((key) => !(key in RECORDED));

    expect(missing).toEqual([]);
  });

  it.each(recorded)("%s is unchanged", (key, text) => {
    expect(fingerprint(text)).toBe(RECORDED[key]);
  });

  it("records nothing for a version that no longer exists", () => {
    const live = new Set(recorded.map(([key]) => key));

    expect(Object.keys(RECORDED).filter((key) => !live.has(key))).toEqual([]);
  });

  it("notices a single edited word", () => {
    // The lock is only worth having if it is sensitive. One character.
    const original = versionedText(PROMPT_CATALOGUE[0], "A2");

    expect(fingerprint(original)).not.toBe(fingerprint(`${original} `));
    expect(fingerprint(original)).not.toBe(fingerprint(original.replace("At most", "At Most")));
  });

  it("gives each machine entry its own fingerprint, because each asks for a different shape", () => {
    const machine = PROMPT_CATALOGUE.filter((entry) => entry.register === "machine");
    const hashes = machine.map((entry) => fingerprint(versionedText(entry)));

    expect(machine.length).toBeGreaterThan(1);
    expect(new Set(hashes).size).toBe(machine.length);
  });

  it("notices a tightened field cap in an output contract", () => {
    // The contract is generated from the schema, so a change nobody thought of
    // as a prompt edit is one.
    const entry = PROMPT_CATALOGUE.find(
      (candidate) => candidate.name === "evaluation.learner_message",
    ) as PromptCatalogEntry;

    const loosened = buildOutputContract(entry.outputContract) as string;

    expect(fingerprint(loosened)).not.toBe(
      fingerprint(loosened.replace("at most 50", "at most 20")),
    );
  });

  it("gives each level its own fingerprint, because each is its own behaviour", () => {
    const perLevel = CEFR_LEVELS.map((level) =>
      fingerprint(versionedText(PROMPT_CATALOGUE[0], level)),
    );

    expect(new Set(perLevel).size).toBe(CEFR_LEVELS.length);
  });
});

describe("the trainer's prompt", () => {
  /**
   * The same lock, for the one prompt that lives outside the catalogue: the
   * Trainer's system prompt is a fixed string handed to an agent loop, so it
   * is fingerprinted directly. Same contract as above — an edit is either a
   * hash update (no behavioural effect) or a version bump, never unnoticed.
   */
  const RECORDED_TRAINER: Readonly<Record<string, string>> = {
    // Version 4: the agenda ends on a reading item. The news stopped being
    // something offered if the learner asked and became the last thing every
    // session does — retold at their level, then judged on what they
    // understood. (Version 3 ended the session with a recall list; version 2
    // introduced the agenda: open by listing what the sitting covers, quiz
    // only the item the tool hands over, never ask the same question twice.)
    // Version 6: a recurring mistake arrives as background ("struggles"), and
    // the trainer writes the exercise itself — a flawed sentence to fix or a
    // sentence to produce — instead of reading the recorded note out as if it
    // were one. Items are capped at three exchanges, then recorded incorrect
    // and returned to a later session. The exercise line is bolded. (Version
    // 5 taught corrections in English with model sentences; version 4 ended
    // the agenda on a reading item.)
    "trainer.session@6": "6116942f",
  };

  it("matches its recorded fingerprint", () => {
    const key = `${TRAINER_PROMPT_NAME}@${TRAINER_PROMPT_VERSION}`;

    expect(RECORDED_TRAINER[key]).toBeDefined();
    expect(fingerprint(trainerSystemPrompt())).toBe(RECORDED_TRAINER[key]);
  });
});
