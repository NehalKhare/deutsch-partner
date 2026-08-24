import type { CEFRLevel, EffectiveLevel } from "@/domain/cefr";
import { HISTORY_WINDOW } from "@/domain/conversation";
import type { LearningEvaluation } from "@/domain/evaluation";
import type { LearnerProfile, LearnerState } from "@/domain/learner";
import type { MiniLevelDefinition } from "@/domain/mini-level";
import type { RetrievalIntent } from "@/domain/retrieval";
import type { LearnerContext, PromptMessage } from "@/lib/ai/prompts";
import type { RetrievedChunk } from "@/lib/retrieval/retriever";

/**
 * The state one turn carries from node to node.
 *
 * Every field is optional after the first, because a node that could not run
 * should leave the turn degraded rather than broken: no retrieval still
 * produces a reply, a failed evaluation still leaves the message saved. The
 * runner records which nodes ran and which were skipped, so a thin answer can
 * be explained afterwards instead of guessed at.
 */

export interface TurnInput {
  readonly learnerId: string;
  readonly threadId: string;
  readonly message: string;
  /**
   * The recent transcript, resent by the client each turn.
   *
   * The conversation lives in the learner's browser and nowhere else, so the
   * server cannot look it up — whatever context the tutor gets arrives here.
   * Validated and capped at the API boundary, and clamped again on entry.
   */
  readonly history: readonly PromptMessage[];
  readonly requestId: string;
  readonly userIdHash: string;
  readonly traceId?: string;
}

export interface LoadedLearner {
  readonly profile: LearnerProfile;
  readonly state: LearnerState;
  readonly miniLevel: MiniLevelDefinition;
  readonly effectiveLevel: EffectiveLevel;
  readonly cefr: CEFRLevel;
  /** The compact projection the prompt renders, built once per turn. */
  readonly context: LearnerContext;
}

export interface TurnState {
  readonly input: TurnInput;
  readonly learner?: LoadedLearner;
  readonly history?: readonly PromptMessage[];
  readonly intent?: RetrievalIntent;
  readonly knowledge?: readonly RetrievedChunk[];
  readonly reply?: {
    readonly text: string;
    readonly truncated: boolean;
  };
  readonly evaluation?: LearningEvaluation;
  /** Accumulated euro cost of every model call this turn made. */
  readonly costEur: number;
  readonly notes: readonly TurnNote[];
}

export interface TurnNote {
  readonly node: string;
  readonly outcome: "ok" | "skipped" | "degraded" | "failed";
  readonly detail?: string;
}

export const initialState = (input: TurnInput): TurnState => ({
  input,
  // Clamped here as well as at the API boundary: the window is a context
  // budget, and a budget enforced in one place is a budget until somebody
  // adds a second caller.
  history: input.history.slice(-HISTORY_WINDOW),
  costEur: 0,
  notes: [],
});

export function note(
  state: TurnState,
  node: string,
  outcome: TurnNote["outcome"],
  detail?: string,
): TurnState {
  return { ...state, notes: [...state.notes, { node, outcome, detail }] };
}

export function spend(state: TurnState, costEur: number): TurnState {
  return { ...state, costEur: state.costEur + costEur };
}

/** Whether a node's work actually landed, for a caller deciding what to show. */
export function ran(state: TurnState, node: string): boolean {
  return state.notes.some((entry) => entry.node === node && entry.outcome === "ok");
}
