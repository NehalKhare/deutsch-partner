import { z } from "zod";

import { cefrLevelSchema, type CEFRLevel } from "@dp/domain/cefr";
import { planCodeSchema } from "@dp/domain/plans";
import { nonEmptyTextSchema } from "@dp/domain/primitives";
import { tierFor } from "@dp/domain/tasks";
import { TUTOR, VOICE_GENDERS, tutorFor, type TutorPersona } from "@dp/domain/tutor";
import {
  MIN_RECENT_MESSAGES,
  SHEDDING_ORDER,
  STABLE_PREFIX_BLOCKS,
  STABLE_PREFIX_CAPS,
  UNTRUSTED_BLOCKS,
  blockCap,
  type BlockId,
  type Register,
} from "./blocks";
import type { BehaviorPolicy } from "./behavior-policy";
import { entryCeilings, type PromptCatalogEntry } from "./catalogue";
import { STREAMED_TEXT, describeContract, type OutputContract } from "./contract";
import {
  buildBehaviorPolicyBlock,
  buildCorrectionPolicy,
  buildDataBoundaryBlock,
  buildIdentityBlock,
  buildLearnerContext,
  buildMemoryBlock,
  buildOutputContract,
  buildRecentMessages,
  buildResponsePolicy,
  buildRetrievalContext,
  buildSafetyBlock,
  buildThreadSummary,
  buildUserMessage,
  learnerContextSchema,
  learnerMemorySchema,
  promptMessageSchema,
  retrievedChunkSchema,
} from "./sections";
import { estimateTokens, truncateToTokens } from "./tokens";

/**
 * The prompt builder.
 *
 * It assembles blocks in the catalogue's declared order, holds each to its own
 * cap, and if the total is still over the task's input ceiling it sheds
 * context in the order the routing document fixes — never in the order the
 * caller happens to prefer, and never silently at the call site.
 *
 * It does not dispatch anything. Building is the dry run: the result carries
 * the assembled text and its token count, which is what the budget tests
 * assert against.
 */

export const buildRequestSchema = z.strictObject({
  policy: z.custom<BehaviorPolicy>((value) => typeof value === "object" && value !== null),
  cefr: cefrLevelSchema,
  learner: learnerContextSchema,
  threadSummary: nonEmptyTextSchema(8000).nullish(),
  knowledge: z.array(retrievedChunkSchema).max(20).default([]),
  memories: z.array(learnerMemorySchema).max(20).default([]),
  recentMessages: z.array(promptMessageSchema).max(40).default([]),
  userMessage: nonEmptyTextSchema(4000),
  /**
   * The learner's plan, resolved on the server. It widens or keeps the input
   * and output ceilings the prompt is shed against, and nothing else: no block
   * reads it, so no plan is a different prompt version.
   */
  plan: planCodeSchema.optional(),
  /**
   * The learner's chosen voice, which is also their choice of tutor: Jonas or
   * Alex. Read by the identity block alone. Unlike the plan, it does change
   * the versioned text — a different name is a different promise — so the
   * lock records a fingerprint per persona.
   */
  tutorVoice: z.enum(VOICE_GENDERS).default(TUTOR.voice),
});

export type BuildRequest = z.input<typeof buildRequestSchema>;

export interface RenderedBlock {
  readonly id: BlockId;
  readonly text: string;
  readonly tokens: number;
  readonly truncated: boolean;
}

export interface ShedRecord {
  readonly block: BlockId;
  /** How many items were dropped, or 0 when the whole block went. */
  readonly dropped: number;
  readonly tokensReclaimed: number;
}

export interface AssembledPrompt {
  readonly name: string;
  readonly version: number;
  readonly task: string;
  readonly tier: string;
  /** Blocks 1 to 11: what goes in the system role. */
  readonly system: string;
  /**
   * The leading run of system blocks that comes from the catalogue entry
   * rather than from caller data (the versioned blocks), so it is
   * byte-identical on every turn of the task. A prefix of `system`, offered
   * to the gateway so a provider's prompt cache can cover it.
   */
  readonly systemStable: string;
  /** Block 12: what goes in the user role, already fenced. */
  readonly user: string;
  readonly blocks: readonly RenderedBlock[];
  readonly tokens: {
    readonly stablePrefix: number;
    readonly system: number;
    readonly user: number;
    readonly total: number;
  };
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly shed: readonly ShedRecord[];
}

export type BuildOutcome =
  | { readonly ok: true; readonly prompt: AssembledPrompt }
  | {
      readonly ok: false;
      readonly reason: "invalid_input" | "over_budget";
      readonly detail: string;
    };

function render(id: BlockId, text: string, cap: number): RenderedBlock {
  const capped = Number.isFinite(cap) ? truncateToTokens(text, cap) : text;

  return {
    id,
    text: capped,
    tokens: estimateTokens(capped),
    truncated: capped.length < text.length,
  };
}

interface Context extends SheddableContext {
  readonly register: Register;
  /** What the message block may occupy: the ceiling minus everything fixed. */
  readonly messageCap: number;
  readonly policy: BehaviorPolicy;
  readonly cefr: CEFRLevel;
  readonly learner: z.infer<typeof learnerContextSchema>;
  readonly userMessage: string;
  readonly outputContract: OutputContract;
  readonly tutor: TutorPersona;
}

/** Renders one block from the current context, or null when it has nothing to say. */
function renderBlock(id: BlockId, context: Context): RenderedBlock | null {
  // The message is rendered whole. Truncating it would silently analyse or
  // answer something the learner did not say, which is worse than refusing:
  // if it does not fit, the budget check below rejects and the caller decides.
  const cap =
    id === "user_message" ? Number.POSITIVE_INFINITY : blockCap(context.register, id);

  switch (id) {
    case "identity":
      return render(id, buildIdentityBlock(context.register, context.tutor), cap);
    case "safety":
      return render(id, buildSafetyBlock(context.register), cap);
    case "data_boundary":
      return render(id, buildDataBoundaryBlock(context.register), cap);
    case "output_contract": {
      // Generated from the entry's own schema, so the prompt and the validator
      // cannot describe different shapes.
      const contract = buildOutputContract(context.outputContract);
      return contract === null ? null : render(id, contract, cap);
    }
    case "behavior_policy":
      return render(id, buildBehaviorPolicyBlock(context.policy), cap);
    case "correction_policy":
      return render(id, buildCorrectionPolicy(context.policy), cap);
    case "response_policy":
      return render(id, buildResponsePolicy(context.policy), cap);
    case "learner_state":
      return render(id, buildLearnerContext(context.learner), cap);
    case "thread_summary":
      return context.threadSummary && !context.summaryDropped
        ? render(id, buildThreadSummary(context.threadSummary), cap)
        : null;
    case "retrieved_knowledge":
      return context.knowledge.length > 0
        ? render(id, buildRetrievalContext(context.knowledge), cap)
        : null;
    case "learner_memory":
      return context.memories.length > 0
        ? render(id, buildMemoryBlock(context.memories), cap)
        : null;
    case "recent_messages":
      return context.recentMessages.length > 0
        ? render(id, buildRecentMessages(context.recentMessages), cap)
        : null;
    case "user_message":
      return render(id, buildUserMessage(context.userMessage), cap);
  }
}

/**
 * What the message may occupy once everything that cannot be shed has taken
 * its share. Derived rather than fixed, because a single-label classifier and
 * a thread summariser have wildly different room and neither should be sized
 * for the other.
 */
export function messageCapFor(
  entry: PromptCatalogEntry,
  maxInputTokens: number,
): number {
  const fixed = entry.blocks
    .filter((id) => id !== "user_message" && !SHEDDING_ORDER.includes(id))
    .reduce((sum, id) => {
      // The contract is the one fixed block whose true size is known here: it
      // is derived from the entry rather than from anything a caller sends.
      // Reserving its cap instead would cost a single-label classifier most of
      // its ceiling to describe a shape that renders in twenty tokens.
      if (id === "output_contract") {
        return (
          sum +
          (entry.outputContract === STREAMED_TEXT
            ? 0
            : estimateTokens(describeContract(entry.outputContract)))
        );
      }

      return sum + blockCap(entry.register, id);
    }, 0);

  return maxInputTokens - fixed;
}

function assemble(
  entry: PromptCatalogEntry,
  context: Context,
): readonly RenderedBlock[] {
  return entry.blocks
    .map((id) => renderBlock(id, context))
    .filter((block): block is RenderedBlock => block !== null);
}

const total = (blocks: readonly RenderedBlock[]) =>
  blocks.reduce((sum, block) => sum + block.tokens, 0);

/** The part of the context that shedding is allowed to touch. */
export interface SheddableContext {
  readonly knowledge: readonly z.infer<typeof retrievedChunkSchema>[];
  readonly memories: readonly z.infer<typeof learnerMemorySchema>[];
  readonly recentMessages: readonly z.infer<typeof promptMessageSchema>[];
  readonly threadSummary: string | null;
  readonly summaryDropped: boolean;
}

export interface ShedStep {
  readonly block: BlockId;
  readonly context: SheddableContext;
}

function weakestIndex<T>(items: readonly T[], weight: (item: T) => number): number {
  return items.reduce(
    (worst, item, index) => (weight(item) < weight(items[worst]) ? index : worst),
    0,
  );
}

/**
 * Drops one item from the next block in the shedding order.
 *
 * One item at a time on purpose: dropping a whole block to save fifty tokens
 * throws away context that would have fitted. Pure, and exported, because the
 * later rungs of this ladder are not reachable under today's caps — the only
 * way to hold their ordering to account is to drive them directly.
 *
 * Returns null when nothing is left that may be shed.
 */
export function shedOne(context: SheddableContext): ShedStep | null {
  for (const block of SHEDDING_ORDER) {
    if (block === "recent_messages" && context.recentMessages.length > MIN_RECENT_MESSAGES) {
      // Oldest first: the turn being answered needs the most recent ones.
      return { block, context: { ...context, recentMessages: context.recentMessages.slice(1) } };
    }

    if (block === "retrieved_knowledge" && context.knowledge.length > 0) {
      const weakest = weakestIndex(context.knowledge, (chunk) => chunk.score);
      return {
        block,
        context: {
          ...context,
          knowledge: context.knowledge.filter((_, index) => index !== weakest),
        },
      };
    }

    if (block === "learner_memory" && context.memories.length > 0) {
      const weakest = weakestIndex(context.memories, (memory) => memory.salience);
      return {
        block,
        context: {
          ...context,
          memories: context.memories.filter((_, index) => index !== weakest),
        },
      };
    }

    if (block === "thread_summary" && context.threadSummary && !context.summaryDropped) {
      // Last, because losing it costs the whole thread rather than one item.
      return { block, context: { ...context, summaryDropped: true } };
    }
  }

  return null;
}

/**
 * The blocks a version is a promise about.
 *
 * Everything that comes from the catalogue entry rather than from a caller's
 * data. Fingerprinting the whole system prompt would produce a different hash
 * every turn, which is a hash of the conversation rather than of the prompt.
 */
export const VERSIONED_BLOCKS: readonly BlockId[] = [
  "identity",
  "safety",
  "data_boundary",
  "output_contract",
  "behavior_policy",
  "correction_policy",
  "response_policy",
];

/** The text behind a prompt's recorded version fingerprint. */
export function versionedText(prompt: AssembledPrompt): string {
  return prompt.blocks
    .filter((block) => VERSIONED_BLOCKS.includes(block.id))
    .map((block) => block.text)
    .join("\n\n");
}

export function buildPrompt(
  entry: PromptCatalogEntry,
  request: BuildRequest,
): BuildOutcome {
  const parsed = buildRequestSchema.safeParse(request);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_input",
      detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
    };
  }

  const input = parsed.data;
  const { maxInputTokens, maxOutputTokens } = entryCeilings(entry, input.cefr, input.plan);

  const messageCap = messageCapFor(entry, maxInputTokens);
  if (messageCap <= 0) {
    return {
      ok: false,
      reason: "over_budget",
      detail: `${entry.name} leaves no room for a message under a ${maxInputTokens} token ceiling`,
    };
  }

  let context: Context = {
    register: entry.register,
    outputContract: entry.outputContract,
    messageCap,
    policy: input.policy,
    cefr: input.cefr,
    learner: input.learner,
    threadSummary: input.threadSummary ?? null,
    knowledge: [...input.knowledge],
    memories: [...input.memories],
    recentMessages: [...input.recentMessages],
    userMessage: input.userMessage,
    summaryDropped: false,
    tutor: tutorFor(input.tutorVoice),
  };

  let blocks = assemble(entry, context);
  const shed = new Map<BlockId, ShedRecord>();

  while (total(blocks) > maxInputTokens) {
    const before = total(blocks);
    const step = shedOne(context);

    // Nothing left that may be shed. Reject rather than send a prompt over the
    // ceiling: the provider would truncate it somewhere arbitrary, and the
    // arbitrary place is usually the current message.
    if (step === null) {
      return {
        ok: false,
        reason: "over_budget",
        detail: `${before} tokens exceeds the ${maxInputTokens} ceiling with nothing left to shed`,
      };
    }

    context = { ...context, ...step.context };
    blocks = assemble(entry, context);

    const previous = shed.get(step.block);
    shed.set(step.block, {
      block: step.block,
      dropped: (previous?.dropped ?? 0) + 1,
      tokensReclaimed: (previous?.tokensReclaimed ?? 0) + (before - total(blocks)),
    });
  }

  const userBlock = blocks.find((block) => block.id === "user_message");
  const systemBlocks = blocks.filter((block) => block.id !== "user_message");
  const stablePrefix = blocks.filter((block) =>
    STABLE_PREFIX_BLOCKS.includes(block.id),
  );

  // The leading run only, because a cache key is a byte-for-byte prefix: a
  // versioned block that rendered after a caller-data block would sit past
  // the first volatile byte and be worthless to a provider's cache.
  let stableCount = 0;
  while (
    stableCount < systemBlocks.length &&
    VERSIONED_BLOCKS.includes(systemBlocks[stableCount].id)
  ) {
    stableCount += 1;
  }

  return {
    ok: true,
    prompt: {
      name: entry.name,
      version: entry.version,
      task: entry.task,
      // The tier this call is routed to: the entry's own, or the plan's where
      // the plan moves it down.
      tier: input.plan ? tierFor(entry.task, input.plan) : entry.tier,
      system: systemBlocks.map((block) => block.text).join("\n\n"),
      systemStable: systemBlocks
        .slice(0, stableCount)
        .map((block) => block.text)
        .join("\n\n"),
      user: userBlock?.text ?? "",
      blocks,
      tokens: {
        stablePrefix: total(stablePrefix),
        system: total(systemBlocks),
        user: userBlock?.tokens ?? 0,
        total: total(blocks),
      },
      maxInputTokens,
      maxOutputTokens,
      shed: [...shed.values()],
    },
  };
}

export { STABLE_PREFIX_CAPS, UNTRUSTED_BLOCKS, blockCap };
