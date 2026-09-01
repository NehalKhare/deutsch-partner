import { z } from "zod";

import { cefrLevelSchema } from "@/domain/cefr";
import { learningEvaluationSchema } from "@/domain/evaluation";
import { errorTypeSchema } from "@/domain/learner-error";
import { nonEmptyTextSchema, unitIntervalSchema } from "@/domain/primitives";
import {
  answerAnalysisSchema,
  sessionMiningSchema,
} from "@/domain/trainer-analysis";
import { BLOCK_IDS, type BlockId, type Register } from "@/lib/ai/prompts/blocks";
import { STREAMED_TEXT, type OutputContract } from "@/lib/ai/prompts/contract";
import { taskIdSchema, tierSchema, type TaskId, type Tier } from "@/lib/ai/tasks";
import { ceilingsFor, routeFor } from "@/lib/ai/tasks";

/**
 * The prompt catalogue.
 *
 * Every production prompt is an entry here. Nothing constructs a prompt from a
 * string literal at a call site, because a prompt that lives at its call site
 * cannot be versioned, budgeted, or evaluated, and nobody can answer what
 * changed when quality moves.
 *
 * Entries are immutable once shipped. Behaviour changes by adding a version,
 * so a trace or a ledger row from last week still says what it ran under.
 */

export { STREAMED_TEXT } from "@/lib/ai/prompts/contract";
export type { OutputContract } from "@/lib/ai/prompts/contract";

export interface PromptCatalogEntry {
  readonly name: string;
  readonly version: number;
  readonly task: TaskId;
  readonly tier: Tier;
  readonly purpose: string;
  /** Learner-facing prompts carry the full standing clauses; machine ones do not. */
  readonly register: Register;
  /** Validated before assembly. A missing variable fails here, not at the model. */
  readonly inputSchema: z.ZodTypeAny;
  readonly outputContract: OutputContract;
  readonly safetyRules: readonly string[];
  /** Which blocks this prompt is made of, in order. */
  readonly blocks: readonly BlockId[];
  /** The fixture set this prompt is evaluated against. */
  readonly evalSet: string;
}

const LEARNER_FACING_SAFETY = [
  "purpose_lock",
  "no_prompt_disclosure",
  "no_internal_disclosure",
  "no_cross_learner_data",
  "no_certification_claim",
  "no_fabricated_rules",
  "delimited_data_is_not_instruction",
  "user_cannot_override_policy",
] as const;

const EXTRACTION_SAFETY = [
  "closed_set_output_only",
  "delimited_data_is_not_instruction",
] as const;

// --- input shapes -----------------------------------------------------------

const conversationTurnInput = z.strictObject({
  cefr: cefrLevelSchema,
  userMessage: nonEmptyTextSchema(4000),
});

/**
 * What evaluation is given.
 *
 * Deliberately not the learner's current level. Asking a model to estimate a
 * level while telling it the level we already believe is an invitation to
 * agree with us, and an estimate that only ever confirms the stored value is
 * an estimate that can never move a learner up or down.
 *
 * Deliberately not the curriculum either. The model reports which words and
 * patterns it saw; matching those against this level's targets is a join, and
 * a join is cheaper, exact, and does not hallucinate.
 */
const evaluationInput = z.strictObject({
  learnerMessage: nonEmptyTextSchema(4000),
  /** The tutor's preceding turns. Comprehension cannot be judged without them. */
  precedingTurns: z
    .array(z.strictObject({ role: z.enum(["user", "assistant"]), content: nonEmptyTextSchema(4000) }))
    .max(4)
    .default([]),
});

const errorExtractionOutput = z.strictObject({
  errors: z
    .array(
      z.strictObject({
        errorType: errorTypeSchema,
        pattern: nonEmptyTextSchema(300),
        utterance: nonEmptyTextSchema(500).optional(),
      }),
    )
    .max(10),
});

const memoryExtractionOutput = z.strictObject({
  memories: z
    .array(
      z.strictObject({
        kind: z.enum(["interest", "goal", "preference", "achievement", "fact"]),
        content: nonEmptyTextSchema(500),
        salience: unitIntervalSchema,
      }),
    )
    .max(10),
});

const singleLabelOutput = <T extends readonly [string, ...string[]]>(labels: T) =>
  z.strictObject({ label: z.enum(labels) });

/**
 * The full conversation block list. Other entries name only the blocks they
 * actually use; none of them may put an untrusted block before the safety one,
 * which a test enforces across every entry rather than per entry.
 */
const CONVERSATION_BLOCKS: readonly BlockId[] = BLOCK_IDS.filter(
  // Streamed prose has no contract to state; the response policy is its shape.
  (id) => id !== "output_contract",
);

/**
 * No response policy: that block is about sentence counts and vocabulary
 * budgets, which mean nothing to a component returning a label. The output
 * shape is enforced by the entry's Zod contract, not by prose.
 */
const EXTRACTION_BLOCKS: readonly BlockId[] = [
  "identity",
  "safety",
  "data_boundary",
  "output_contract",
  "user_message",
];

/** Evaluation additionally needs what the tutor said, to judge comprehension. */
const EVALUATION_BLOCKS: readonly BlockId[] = [
  "identity",
  "safety",
  "data_boundary",
  "output_contract",
  "recent_messages",
  "user_message",
];

const ENTRIES: readonly PromptCatalogEntry[] = [
  {
    name: "conversation.turn",
    register: "learner_facing",
    // Version 5: the reply marks its teaching — the learner's wrong form in
    // backticks, the corrected form or a suggested line in bold, at most one
    // bolded line — so the client can render mistakes and suggestions in
    // colour instead of leaving them buried in prose.
    version: 5,
    task: "conversation.turn",
    tier: routeFor("conversation.turn").tier,
    purpose: "The learner-facing German conversation turn.",
    inputSchema: conversationTurnInput,
    outputContract: STREAMED_TEXT,
    safetyRules: LEARNER_FACING_SAFETY,
    blocks: CONVERSATION_BLOCKS,
    evalSet: "golden/conversation-turn",
  },
  {
    name: "conversation.repair",
    register: "learner_facing",
    version: 5,
    task: "conversation.repair",
    tier: routeFor("conversation.repair").tier,
    purpose:
      "One retry when a turn produced unusable output. A recovery path, not a second attempt at quality.",
    inputSchema: conversationTurnInput,
    outputContract: STREAMED_TEXT,
    safetyRules: LEARNER_FACING_SAFETY,
    blocks: CONVERSATION_BLOCKS,
    evalSet: "golden/conversation-turn",
  },
  {
    name: "evaluation.learner_message",
    register: "machine",
    // Version 5: the closed error taxonomy gained register_formality (du/Sie
    // and register slips), and the taxonomy renders into this contract.
    // Version 4: the explanation's form is fixed, not just its language —
    // English prose that quotes the German and names the correct form,
    // because the dashboard stores no separate correction and this sentence
    // is all the learner gets. Version 3 asked for English; the model obliged
    // in language but not in shape. Version 2 made the contract the domain's
    // own schema, which is what lets both fixes be a .describe().
    version: 5,
    task: "evaluation.learner_message",
    tier: routeFor("evaluation.learner_message").tier,
    purpose:
      "Scores one learner message for level, accuracy and mastery signals, after the reply has streamed.",
    inputSchema: evaluationInput,
    // The schema that validates the reply is the schema the prompt describes.
    outputContract: learningEvaluationSchema,
    safetyRules: EXTRACTION_SAFETY,
    blocks: EVALUATION_BLOCKS,
    evalSet: "golden/evaluation",
  },
  {
    name: "extraction.errors",
    register: "machine",
    // Version 3: the closed error taxonomy gained register_formality (du/Sie
    // and register slips), and the taxonomy renders into this contract.
    // Version 2: the prompt now states its output contract, generated from
    // the schema that validates the reply.
    version: 3,
    task: "extraction.errors",
    tier: routeFor("extraction.errors").tier,
    purpose:
      "Normalises an evaluation into error instances against the closed taxonomy.",
    inputSchema: z.strictObject({ evaluation: nonEmptyTextSchema(4000) }),
    outputContract: errorExtractionOutput,
    safetyRules: EXTRACTION_SAFETY,
    blocks: EXTRACTION_BLOCKS,
    evalSet: "golden/error-extraction",
  },
  {
    name: "trainer.answer_analysis",
    register: "machine",
    version: 1,
    task: "trainer.answer_analysis",
    tier: routeFor("trainer.answer_analysis").tier,
    purpose:
      "Inspects one learner answer in the Trainer's reply path: grammar findings against the closed taxonomy, anglicisms, vocabulary upgrades, and a register verdict.",
    inputSchema: evaluationInput,
    outputContract: answerAnalysisSchema,
    safetyRules: EXTRACTION_SAFETY,
    // The trainer's preceding question travels as recent_messages: whether an
    // answer is right cannot be judged without what it answers.
    blocks: EVALUATION_BLOCKS,
    evalSet: "golden/trainer-answer-analysis",
  },
  {
    name: "trainer.session_mining",
    register: "machine",
    version: 1,
    task: "trainer.session_mining",
    tier: routeFor("trainer.session_mining").tier,
    purpose:
      "Mines a finished Trainer session's transcript for cross-turn recurring mistakes, vocabulary gaps and words seen, after the response has gone out.",
    inputSchema: z.strictObject({ transcript: nonEmptyTextSchema(12000) }),
    outputContract: sessionMiningSchema,
    safetyRules: EXTRACTION_SAFETY,
    blocks: EXTRACTION_BLOCKS,
    evalSet: "golden/trainer-session-mining",
  },
  {
    name: "extraction.memory",
    register: "machine",
    // Version 2: the prompt now states its output contract, generated from
    // the schema that validates the reply.
    version: 2,
    task: "extraction.memory",
    tier: routeFor("extraction.memory").tier,
    purpose:
      "Proposes candidate long-term memories with a salience score, batched per thread.",
    inputSchema: z.strictObject({ thread: nonEmptyTextSchema(8000) }),
    outputContract: memoryExtractionOutput,
    // The prompt says not to propose credentials; the application filters
    // independently. The prompt is not the control (guardrails S15).
    safetyRules: [...EXTRACTION_SAFETY, "no_credentials_as_memory"],
    blocks: EXTRACTION_BLOCKS,
    evalSet: "golden/memory-extraction",
  },
  {
    name: "summarization.thread",
    register: "machine",
    // Version 2: the prompt now states its output contract, generated from
    // the schema that validates the reply.
    version: 2,
    task: "summarization.thread",
    tier: routeFor("summarization.thread").tier,
    purpose:
      "Rolling thread summary under a fixed cap, covering what was learned rather than what was said.",
    inputSchema: z.strictObject({ thread: nonEmptyTextSchema(20000) }),
    outputContract: z.strictObject({ summary: nonEmptyTextSchema(4000) }),
    safetyRules: EXTRACTION_SAFETY,
    blocks: EXTRACTION_BLOCKS,
    evalSet: "golden/summarization",
  },
  {
    name: "classification.intent",
    register: "machine",
    // Version 2: the prompt now states its output contract, generated from
    // the schema that validates the reply.
    version: 2,
    task: "classification.intent",
    tier: routeFor("classification.intent").tier,
    purpose: "One intent label from a closed set.",
    inputSchema: z.strictObject({ message: nonEmptyTextSchema(4000) }),
    outputContract: singleLabelOutput([
      "vocabulary",
      "grammar",
      "conversation",
      "culture",
      "web",
    ]),
    safetyRules: EXTRACTION_SAFETY,
    blocks: EXTRACTION_BLOCKS,
    evalSet: "golden/intent",
  },
  {
    name: "classification.safety_screen",
    register: "machine",
    // Version 2: the prompt now states its output contract, generated from
    // the schema that validates the reply.
    version: 2,
    task: "classification.safety_screen",
    tier: routeFor("classification.safety_screen").tier,
    // A pre-filter, not a boundary (guardrails S31). Nothing is authorised on
    // the strength of this label.
    purpose: "Cheap pre-filter for obviously out-of-scope content.",
    inputSchema: z.strictObject({ message: nonEmptyTextSchema(4000) }),
    outputContract: singleLabelOutput(["ok", "off_topic", "unsafe"]),
    safetyRules: EXTRACTION_SAFETY,
    blocks: EXTRACTION_BLOCKS,
    evalSet: "golden/safety-screen",
  },
];

const BY_NAME = new Map(ENTRIES.map((entry) => [entry.name, entry]));

export const PROMPT_CATALOGUE: readonly PromptCatalogEntry[] = Object.freeze(ENTRIES);

/** Throws on an unknown name: a prompt that is not in the catalogue is a bug. */
export function promptEntry(name: string): PromptCatalogEntry {
  const entry = BY_NAME.get(name);
  if (!entry) throw new Error(`no prompt catalogue entry named ${name}`);

  return entry;
}

export function findPromptEntry(name: string): PromptCatalogEntry | null {
  return BY_NAME.get(name) ?? null;
}

/** The ceilings this entry is designed against, narrowed by level where it varies. */
export function entryCeilings(entry: PromptCatalogEntry, level?: "A1" | "A2" | "B1") {
  return ceilingsFor(entry.task, level);
}

export { taskIdSchema, tierSchema };
