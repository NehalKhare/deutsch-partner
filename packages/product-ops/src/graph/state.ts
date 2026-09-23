import { Annotation } from "@langchain/langgraph";

import type { ProductOpsStage, ReviewAction } from "@dp/domain/product-ops";
import type { AdvanceResult } from "../workflow";

/**
 * The graph's state: control flow and identifiers, nothing else.
 *
 * Deliberately thin. The proposal, the PRD, the plan and the changes live in
 * their own tables and a node that needs one reads it from there; a checkpoint
 * that carried them would be a second copy of the truth, and the checkpoint
 * table is readable by an operator. What the graph keeps is where the run
 * stands, what the last node reported, and how many nodes this invocation has
 * run — the bound that turns a loop into a typed stop.
 */
export const ProductOpsGraphState = Annotation.Root({
  /** The run this thread is. Also the thread id. */
  runId: Annotation<string>,
  /** The stage the run stood at after the last node, as the database says. */
  stage: Annotation<ProductOpsStage | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  /** What the last node reported. Null before any node has run. */
  last: Annotation<AdvanceResult | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  /** Nodes run in this invocation. Reset by the entry node. */
  steps: Annotation<number>({
    reducer: (previous, next) => (next === 0 ? 0 : previous + next),
    default: () => 0,
  }),
});

export type ProductOpsGraphStateType = typeof ProductOpsGraphState.State;

/**
 * What the graph asks a person when it parks at a gate.
 *
 * Shown to nobody directly — the operator decides on the proposal page, which
 * reads rows — but recorded on the interrupt so a tool inspecting the thread
 * can see what it is waiting for.
 */
export interface GatePrompt {
  readonly kind: "proposal" | "plan";
  readonly runId: string;
  readonly stage: ProductOpsStage;
}

/**
 * How a gate is resumed.
 *
 * `review` is the decision to apply. Null means "look at the database": the
 * server action has already recorded the review and moved the run, and the
 * gate node should adopt that rather than decide again. Both orders converge
 * on the same rows, which is what makes a double resume harmless.
 */
export interface GateDecision {
  readonly review: ReviewAction | null;
}
