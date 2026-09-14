import { describe, expect, it } from "vitest";

import { CEFR_LEVELS } from "@/domain/cefr";
import {
  TRAINER_PROMPT_NAME,
  TRAINER_PROMPT_VERSION,
  trainerSystemPrompt,
} from "@/lib/ai/prompts/trainer";
import {
  PRODUCT_OPS_AGENTS,
  PRODUCT_OPS_AGENT_PROMPT_VERSION,
  productOpsAgentPromptName,
  productOpsAgentPromptText,
} from "@/lib/ai/prompts/product-ops-agents";
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
  // Version 5: the reply marks its teaching — the wrong form in backticks,
  // the corrected form or one suggested line in bold — so mistakes and
  // suggestions render in colour. (Version 4 fixed the correction's shape.)
  "conversation.turn@5/A1": "7e503226",
  "conversation.turn@5/A2": "61631c4b",
  "conversation.turn@5/B1": "cb5b0716",
  "conversation.repair@5/A1": "7e503226",
  "conversation.repair@5/A2": "61631c4b",
  "conversation.repair@5/B1": "cb5b0716",
  // Version 5 (evaluation) / version 3 (extraction.errors): the closed error
  // taxonomy gained register_formality — du/Sie and register slips — and the
  // taxonomy renders into both output contracts. (Version 4 fixed the
  // evaluation explanation's form, not just its language: English prose
  // quoting the German and naming the correct form, because that one sentence
  // is all the dashboard shows.)
  "evaluation.learner_message@5": "53c3d75c",
  "extraction.errors@3": "ff6a17a2",
  // Version 1: the Trainer's two specialist calls — the in-turn answer
  // analyzer and the post-session miner. Structured workers in the
  // evaluator's mould, never a second conversational voice.
  "trainer.answer_analysis@1": "3f6fd6a9",
  "trainer.session_mining@1": "19b070cb",
  "extraction.memory@2": "64dd8afe",
  "summarization.thread@2": "b9388353",
  "classification.intent@2": "34b3ed0b",
  "classification.safety_screen@2": "74efe76c",
  // Version 1: the five product-ops calls. All machine register, and all five
  // read untrusted text — search results, internal documents, repository
  // source — so their versioned text is the identity, safety, data-boundary
  // and output-contract blocks, and none of it is caller data.
  // Version 2 (market_research): one finding per call with tighter list caps,
  // because two did not fit the cheap tier's 600 output tokens — the model
  // wrote valid JSON and the ceiling cut it off mid-array.
  "productops.market_research@2": "b9782c34",
  "productops.proposal_synthesis@1": "acba729e",
  "productops.prd_sections@2": "18dbec01",
  "productops.code_plan@1": "4f387e2a",
  "productops.plan_breakdown@1": "c3890202",
  "productops.code_edit@1": "74c5f47f",
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
    // Version 8: three changes landed as one bump. Closing and advancing
    // collapse into a single call — get_review_session takes a "record" of the
    // item just judged, so the fumbled two-call sequence that re-asked answered
    // questions is gone. Some learner messages arrive with a fenced
    // <answer_analysis> block, a machine check the trainer consumes without
    // ever mentioning; and a "teach" item may now be a culture note —
    // formality, register, politeness — scheduled like a grammar pattern.
    // (Version 7 made the session a declared mix ending on the news; version 6
    // introduced "struggles" background and the three-exchange cap; version 5
    // taught corrections in English with model sentences; version 4 ended the
    // agenda on a reading item.)
    // Version 9: the agenda is announced exactly once. The tool now returns
    // the listing on the opening call alone, and the protocol says so — plus
    // two behaviours the screenshot of a wandering session demanded: once the
    // session is open, get_review_session is only called with "record" (a
    // bare call repeats the same next item), and an empty agenda gets a
    // concrete offer — grammar, vocabulary, a rule explained, or the news —
    // rather than "something else".
    "trainer.session@9": "c99e21ed",
    // Version 10: a session that stalled on one item forced two rules. A
    // correct answer ends an item at once — recorded, never rewarded with
    // another exercise — and a record must name the subject exactly as the
    // agenda does, because the tool now applies a record naming anything
    // else (a closed item, a learner's sentence) to the open item instead.
    // Version 11: the trainer learns from feedback. A new rules block tells
    // it that the learner can steer the coaching — brief or detailed
    // explanations, gentler or harder exercises, shorter sessions, a focus,
    // no news — through a new adjust_coaching tool when asked in words, and
    // to follow the standing requests rendered behind this fixed text. The
    // rendered block itself is caller data, outside this lock, like the
    // catalogue's learner-state block. (Version 10 closed items on the first
    // correct answer and named records by the agenda's subject.)
    "trainer.session@11": "afda6e81",
    // Version 12: the learner chooses the trainer's manner. The identity no
    // longer calls the sessions "warm" — that was the friendly personality
    // written into the fixed text, and a strict trainer cannot be told to be
    // warm and exacting in one breath — and a new rules block says a block
    // headed "Your manner" follows, sets tone, praise and how a correction is
    // put, and changes neither the protocol nor the judgement of answers. The
    // rendered manner itself is a per-learner template behind this lock, like
    // the coaching block. (Version 11 taught the trainer to learn from
    // feedback through adjust_coaching and the standing-requests block.)
    "trainer.session@12": "548777ec",
  };

  it("matches its recorded fingerprint", () => {
    const key = `${TRAINER_PROMPT_NAME}@${TRAINER_PROMPT_VERSION}`;

    expect(RECORDED_TRAINER[key]).toBeDefined();
    expect(fingerprint(trainerSystemPrompt())).toBe(RECORDED_TRAINER[key]);
  });
});

describe("the product-ops agents' prompts", () => {
  /**
   * The same lock again, for the four agent prompts. Like the trainer's,
   * each is a fixed system string handed to a tool-calling loop, so it is
   * fingerprinted directly; the output contract is generated from the schema
   * at call time and is covered by the schema tests instead.
   */
  const RECORDED_AGENTS: Readonly<Record<string, string>> = {
    // Version 1: the research agent chooses its own queries and records
    // findings as it goes; the CPO reads findings and prior proposals through
    // tools; the planner reads the repository itself; the coder edits through
    // the validation layer, one file per call.
    // Research version 2: every scan opens with read_learner_feedback — the
    // product's own learners, aggregated — before the first web search, so
    // first-party evidence frames the queries.
    "productops.agent.research@2": "d2d7943a",
    "productops.agent.cpo@2": "b07db6e8",
    "productops.agent.planner@2": "48be8e35",
    "productops.agent.coder@1": "9c299bef",
  };

  it.each(PRODUCT_OPS_AGENTS)("%s matches its recorded fingerprint", (agent) => {
    const key = `${productOpsAgentPromptName(agent)}@${PRODUCT_OPS_AGENT_PROMPT_VERSION[agent]}`;

    expect(RECORDED_AGENTS[key]).toBeDefined();
    expect(fingerprint(productOpsAgentPromptText(agent))).toBe(RECORDED_AGENTS[key]);
  });

  it("records nothing for an agent that no longer exists", () => {
    const live = new Set(
      PRODUCT_OPS_AGENTS.map(
        (agent) => `${productOpsAgentPromptName(agent)}@${PRODUCT_OPS_AGENT_PROMPT_VERSION[agent]}`,
      ),
    );

    expect(Object.keys(RECORDED_AGENTS).filter((key) => !live.has(key))).toEqual([]);
  });
});
