import { z } from "zod";

/**
 * The ordered blocks a prompt is assembled from.
 *
 * Order is not cosmetic. The stable blocks come first so the cacheable region
 * is contiguous and a provider's prompt cache can cover it
 * (model-routing-and-cost-control.md S7), and no untrusted block may appear
 * before the safety policy, so the standing instruction about delimited
 * content is always already in force by the time any of it is read.
 */

export const BLOCK_IDS = [
  "identity",
  "safety",
  "data_boundary",
  "output_contract",
  "behavior_policy",
  "correction_policy",
  "response_policy",
  "learner_state",
  "thread_summary",
  "retrieved_knowledge",
  "learner_memory",
  "recent_messages",
  "user_message",
] as const;

export const blockIdSchema = z.enum(BLOCK_IDS);
export type BlockId = z.infer<typeof blockIdSchema>;

/** Blocks 1 to 3: identical on every turn, and the region worth caching. */
export const STABLE_PREFIX_BLOCKS: readonly BlockId[] = [
  "identity",
  "safety",
  "data_boundary",
];

/** Data from outside the system's control. Always fenced, never authoritative. */
export const UNTRUSTED_BLOCKS: readonly BlockId[] = [
  "thread_summary",
  "retrieved_knowledge",
  "learner_memory",
  "recent_messages",
  "user_message",
];

/**
 * Prompts come in two registers.
 *
 * A learner-facing prompt carries the full standing safety clauses, because a
 * model writing to a person can claim a certification or leak another
 * learner's data. A machine-facing prompt returns one label or one object to
 * code that validates it, and it runs on a tier whose whole input ceiling is
 * smaller than those clauses. Giving a nano classifier the conversational
 * preamble is not caution, it is a prompt that can never be built.
 */
export const REGISTERS = ["learner_facing", "machine"] as const;
export type Register = (typeof REGISTERS)[number];

/**
 * Per-block ceilings, in estimated tokens.
 *
 * For a learner-facing prompt these deliberately sum to more than the task
 * ceiling: a block cap bounds one block, and it is shedding that makes the
 * total fit. Sizing them to always fit would permanently starve retrieval to
 * suit the worst case.
 */
const LEARNER_FACING_CAPS: Readonly<Record<BlockId, number>> = {
  identity: 120,
  safety: 340,
  data_boundary: 140,
  output_contract: 600,
  // Raised from 250 when the block gained the redirection protocol: the
  // level text alone was 150, and a cap that truncates the last rule of a
  // policy on every call is a behaviour change nobody can see.
  behavior_policy: 350,
  correction_policy: 200,
  response_policy: 200,
  // Raised from 350 for the scene paragraph a scenario thread carries on
  // top of the level's curriculum: a roleplay at a level with full word,
  // review and error lists measures about 480, and a cap that truncates
  // the stay-in-scene rule on exactly those turns is no cap at all. An
  // ordinary lesson renders well under 200.
  learner_state: 550,
  thread_summary: 400,
  retrieved_knowledge: 1200,
  learner_memory: 300,
  recent_messages: 1200,
  // Sized to hold a message at the domain's own input limit, since this block
  // is never shed and rejecting a valid message would be worse than any cost.
  user_message: 1300,
};

const MACHINE_CAPS: Readonly<Record<BlockId, number>> = {
  // Headroom over the actual text. A cap below what a fixed block renders
  // truncates a policy sentence mid-clause on every single call, which is a
  // behaviour change nobody made and nobody can see.
  identity: 70,
  safety: 100,
  data_boundary: 60,
  // Generated from the entry's own schema, so its true size is known before
  // anything is assembled. The cap is a backstop against a schema that grows
  // without anyone noticing what it costs per call.
  output_contract: 600,
  behavior_policy: 0,
  correction_policy: 0,
  response_policy: 0,
  learner_state: 200,
  thread_summary: 400,
  // Raised for the product-ops tasks, which are the first machine entries to
  // declare this block at all: a page of web results or a region of a source
  // file is the input those calls exist to read, and 800 tokens truncated most
  // of it away. It stays a per-block truncation limit rather than a share of
  // any ceiling — messageCapFor excludes sheddable blocks — so the task's own
  // input ceiling and the shedding order are still what bound a call.
  retrieved_knowledge: 5000,
  learner_memory: 200,
  recent_messages: 800,
  // Bounded by what the ceiling leaves rather than by a constant: a thread
  // summariser and a single-label classifier have nothing in common here.
  user_message: 16000,
};

const CAPS: Readonly<Record<Register, Readonly<Record<BlockId, number>>>> = {
  learner_facing: LEARNER_FACING_CAPS,
  machine: MACHINE_CAPS,
};

export function blockCap(register: Register, id: BlockId): number {
  return CAPS[register][id];
}

/** The stable prefix has its own cap: prefix growth taxes every single turn. */
export const STABLE_PREFIX_CAPS: Readonly<Record<Register, number>> = {
  learner_facing: 600,
  machine: 200,
};

/**
 * What may be dropped when the assembled prompt is over the input ceiling, and
 * in what order (model-routing-and-cost-control.md S6, layer 1).
 *
 * The summary is last because losing it costs the whole thread's context,
 * which is worse than losing any single retrieved chunk or memory.
 */
export const SHEDDING_ORDER: readonly BlockId[] = [
  "recent_messages",
  "retrieved_knowledge",
  "learner_memory",
  "thread_summary",
];

/**
 * Never shed. System policy because it is the only thing holding behaviour in
 * place, learner state because a turn pitched at the wrong level is worse than
 * no turn, and the current message because it is what was asked.
 */
export const UNSHEDDABLE_BLOCKS: readonly BlockId[] = BLOCK_IDS.filter(
  (id) => !SHEDDING_ORDER.includes(id),
);

/** Recent turns kept even under pressure, so a reply still has a thread. */
export const MIN_RECENT_MESSAGES = 2;
