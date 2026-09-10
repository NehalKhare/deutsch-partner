import {
  Command,
  END,
  START,
  StateGraph,
  interrupt,
  type CompiledStateGraph,
} from "@langchain/langgraph";

import {
  OPERATOR_STAGES,
  PRODUCT_OPS_STAGES,
  stageAfterReview,
  stageOwner,
  type OperatorStage,
  type ProductOpsStage,
  type ServerStage,
  type WorkerStage,
} from "@/domain/product-ops";
import { nullLogger } from "@/lib/observability/logger";
import { ProductOpsCheckpointSaver } from "@/lib/product-ops/graph/checkpointer";
import {
  ProductOpsGraphState,
  type GateDecision,
  type GatePrompt,
  type ProductOpsGraphStateType,
} from "@/lib/product-ops/graph/state";
import {
  advanceRun,
  entryStatus,
  nothingRan,
  type AdvanceResult,
  type WorkflowDeps,
} from "@/lib/product-ops/workflow";

/**
 * The product-ops workflow as a LangGraph state graph.
 *
 * One node per stage, and the edges are the stage machine in
 * domain/product-ops.ts: no model chooses the next node. Every work node runs
 * exactly one stage through advanceRun — the same idempotency check, work
 * event and compare-and-set transition the orchestrator has always done — so
 * the graph's checkpoint and the run's row cannot disagree about progress.
 * The two human gates are interrupts: the graph parks, the checkpoint is
 * durable in Postgres, and a server action resumes it.
 *
 * Three things end an invocation early, and all three are ordinary: a gate
 * (the run is waiting), a worker stage on a server with no working tree (the
 * stage is deferred, and the board shows the command), and a compare-and-set
 * lost to another process (raced). A failed stage ends it too, with the run
 * at `failed`.
 *
 * What the graph adds over the loop it replaces is durable control flow with
 * a resume point at the gates, and a place to hang tool-using agents whose
 * middleware needs a runtime. What it does not add is a second source of
 * truth: the state carries identifiers and the last result, and every node
 * re-reads its inputs from the rows.
 */

/** Every stage something runs. Nodes in the graph, one each. */
const WORK_STAGES = PRODUCT_OPS_STAGES.filter(
  (stage): stage is ServerStage | WorkerStage =>
    stageOwner(stage) === "server" || stageOwner(stage) === "worker",
);

/** The entry node: reads where the run stands so routing has something to route on. */
const LOAD = "load";

/**
 * The most nodes one invocation may run.
 *
 * Nine stages, the entry node, and a margin. No legitimate drive is longer,
 * so a run that hits this is a loop, and stopping is the right answer to a
 * loop. This is also what the graph's recursion limit is set from.
 */
export const MAX_GRAPH_STEPS = 12;

type GraphState = ProductOpsGraphStateType;
type NodeName = typeof LOAD | ServerStage | WorkerStage | OperatorStage;

const ROUTE_TO_END = END;

/**
 * The next node for a run standing at `stage`, or END.
 *
 * Owner decides. A terminal stage ends. A gate goes to its gate node, which
 * will interrupt. A worker stage on a process without a workspace ends,
 * deferred rather than failed — the server has no checkout and saying so is
 * more useful than pretending.
 */
function routeFor(
  stage: ProductOpsStage | null,
  hasWorkspace: boolean,
): NodeName | typeof END {
  if (stage === null) return ROUTE_TO_END;

  switch (stageOwner(stage)) {
    case "nobody":
      return ROUTE_TO_END;
    case "operator":
      return stage as OperatorStage;
    case "worker":
      return hasWorkspace ? (stage as WorkerStage) : ROUTE_TO_END;
    case "server":
      return stage as ServerStage;
  }
}

/** Whether the last node's result says the graph may continue. */
function mayContinue(state: GraphState): boolean {
  if (state.steps >= MAX_GRAPH_STEPS) return false;
  if (state.last === null) return true;

  return state.last.status === "advanced";
}

export interface GraphDeps extends WorkflowDeps {
  /** A saver other than the repository-backed one. Tests use MemorySaver. */
  readonly checkpointer?: ProductOpsCheckpointSaver | InstanceType<
    typeof import("@langchain/langgraph").MemorySaver
  >;
}

export type ProductOpsGraph = CompiledStateGraph<
  GraphState,
  Partial<GraphState>,
  string
>;

/**
 * Builds and compiles the graph for one set of dependencies.
 *
 * Compiled per drive rather than once at module load, because the workspace
 * — and therefore which stages are runnable — is a property of the process
 * calling, and the checkpointer is a property of the repository it saves to.
 */
export function compileProductOpsGraph(deps: GraphDeps): ProductOpsGraph {
  const logger = deps.logger ?? nullLogger;
  const hasWorkspace = deps.workspace !== undefined;

  const load = async (state: GraphState): Promise<Partial<GraphState>> => {
    const loaded = await deps.runs.getRun(state.runId);
    if (!loaded.ok) {
      return { stage: null, last: nothingRan("unavailable", null), steps: 0 };
    }

    return { stage: loaded.data.currentStage, last: null, steps: 0 };
  };

  /**
   * A work node: exactly one stage, through the orchestrator.
   *
   * The stage is asserted before anything runs. advanceRun dispatches on
   * the row's current stage, and a node that found the row somewhere else
   * has lost a race with another process; it reports so and the graph ends.
   */
  const work =
    (stage: ServerStage | WorkerStage) =>
    async (state: GraphState): Promise<Partial<GraphState>> => {
      const loaded = await deps.runs.getRun(state.runId);
      if (!loaded.ok) {
        return { stage: null, last: nothingRan("unavailable", null), steps: 1 };
      }
      if (loaded.data.currentStage !== stage) {
        logger.info("productops.graph_raced", {
          runId: state.runId,
          expected: stage,
          stage: loaded.data.currentStage,
        });
        return {
          stage: loaded.data.currentStage,
          last: nothingRan("raced", loaded.data.currentStage),
          steps: 1,
        };
      }

      const result = await advanceRun(deps, state.runId);

      return { stage: result.stage, last: result, steps: 1 };
    };

  /**
   * A gate node: park until a person decides.
   *
   * On first entry, interrupt() throws and the checkpoint records the graph
   * as waiting here. On resume it returns the decision. The decision may be
   * null — "look at the database" — because the server action records the
   * review and may already have moved the run; then the node adopts what it
   * finds. If the run is still at the gate and a review was named, the node
   * performs the same compare-and-set every other transition uses.
   */
  const gate =
    (stage: OperatorStage) =>
    async (state: GraphState): Promise<Partial<GraphState>> => {
      const before = await deps.runs.getRun(state.runId);
      if (!before.ok) {
        return { stage: null, last: nothingRan("unavailable", null), steps: 1 };
      }
      if (before.data.currentStage !== stage) {
        // Already moved, by the action or another process. Adopt.
        return {
          stage: before.data.currentStage,
          last: {
            status: "advanced",
            stage: before.data.currentStage,
            outcome: null,
            costEur: 0,
            detail: null,
          },
          steps: 1,
        };
      }

      const prompt: GatePrompt = {
        kind: stage === "human_review" ? "proposal" : "plan",
        runId: state.runId,
        stage,
      };
      const decision = interrupt<GatePrompt, GateDecision | undefined>(prompt);

      // Resumed. Read the row again: the action that resumed us has very
      // likely recorded the review and moved the run already.
      const after = await deps.runs.getRun(state.runId);
      if (!after.ok) {
        return { stage: null, last: nothingRan("unavailable", null), steps: 1 };
      }
      if (after.data.currentStage !== stage) {
        return {
          stage: after.data.currentStage,
          last: {
            status: "advanced",
            stage: after.data.currentStage,
            outcome: null,
            costEur: 0,
            detail: null,
          },
          steps: 1,
        };
      }

      const to =
        decision?.review === undefined || decision.review === null
          ? null
          : stageAfterReview(stage, decision.review);
      if (to === null) {
        // Nothing to apply: a comment, a reprioritisation, or a nudge. The
        // run stays at its gate and the graph ends waiting.
        return { stage, last: nothingRan("waiting", stage), steps: 1 };
      }

      const moved = await deps.runs.advanceStage({
        runId: state.runId,
        from: stage,
        to,
        event: {
          status: entryStatus(to),
          from: stage,
          review: decision?.review,
          requestId: after.data.requestId,
        },
      });
      if (!moved.ok) {
        return { stage, last: nothingRan("unavailable", stage), steps: 1 };
      }

      return {
        stage: moved.data.stage,
        last: {
          status: moved.data.advanced ? "advanced" : "raced",
          stage: moved.data.stage,
          outcome: null,
          costEur: 0,
          detail: null,
        },
        steps: 1,
      };
    };

  const route = (state: GraphState): NodeName | typeof END =>
    mayContinue(state) ? routeFor(state.stage, hasWorkspace) : ROUTE_TO_END;

  const builder = new StateGraph(ProductOpsGraphState).addNode(LOAD, load);
  for (const stage of WORK_STAGES) builder.addNode(stage, work(stage));
  for (const stage of OPERATOR_STAGES) builder.addNode(stage, gate(stage));

  builder.addEdge(START, LOAD);
  // Every node routes the same way afterwards: by where the row now stands.
  const nodes: readonly NodeName[] = [LOAD, ...WORK_STAGES, ...OPERATOR_STAGES];
  for (const node of nodes) {
    builder.addConditionalEdges(node as never, route as never);
  }

  return builder.compile({
    checkpointer: deps.checkpointer ?? new ProductOpsCheckpointSaver(deps.runs),
  }) as unknown as ProductOpsGraph;
}

function configFor(runId: string) {
  return {
    configurable: { thread_id: runId },
    // Nodes plus the routing steps between them; the state's own step cap
    // stops a loop long before this does, and this stops a bug in the cap.
    recursionLimit: MAX_GRAPH_STEPS * 3,
  };
}

/** Whether the thread is parked at an interrupt, waiting for a decision. */
async function isParked(graph: ProductOpsGraph, runId: string): Promise<boolean> {
  const snapshot = await graph.getState(configFor(runId));

  return snapshot.tasks.some((task) => (task.interrupts?.length ?? 0) > 0);
}

/** The last node's report, or a waiting result for a graph parked at a gate. */
function resultFrom(
  state: Partial<GraphState> | undefined,
  fallback: AdvanceResult,
): AdvanceResult {
  return state?.last ?? fallback;
}

/**
 * Drives a run until something else has to happen.
 *
 * The replacement for the loop around advanceRun. If the thread is parked at
 * a gate, this resumes it with no decision — the gate node re-reads the row
 * and adopts whatever a server action already recorded, or ends waiting if
 * nothing has changed. Otherwise it starts a fresh pass from the entry node,
 * which reads the row and routes. Either way the graph stops at the first
 * stage this process cannot or may not run.
 */
export async function driveRunGraph(
  deps: GraphDeps,
  runId: string,
  review: GateDecision["review"] = null,
): Promise<AdvanceResult> {
  const logger = deps.logger ?? nullLogger;
  const graph = compileProductOpsGraph(deps);
  const config = configFor(runId);

  try {
    const parked = await isParked(graph, runId);
    const input = parked
      ? new Command({ resume: { review } satisfies GateDecision })
      : { runId };

    const state = (await graph.invoke(input, config)) as Partial<GraphState>;
    const snapshot = await graph.getState(config);
    const nowParked = snapshot.tasks.some(
      (task) => (task.interrupts?.length ?? 0) > 0,
    );

    if (nowParked) {
      // The graph stopped at a gate. The stage is where the row says.
      const stage = state.stage ?? (await stageOf(deps, runId));
      return resultFrom(
        state.last?.status === "advanced" ? undefined : state,
        nothingRan("waiting", stage),
      );
    }

    return resultFrom(state, nothingRan("finished", state.stage ?? null));
  } catch (error) {
    // A saver that cannot persist, or a node that threw past its own typed
    // failure. Nothing was decided that the rows do not already say.
    logger.warn("productops.graph_failed", {
      runId,
      errorCode:
        error instanceof Error && error.name.length > 0
          ? error.name.slice(0, 64)
          : "unknown_error",
    });
    return nothingRan("unavailable", await stageOf(deps, runId));
  }
}

async function stageOf(
  deps: GraphDeps,
  runId: string,
): Promise<ProductOpsStage | null> {
  const loaded = await deps.runs.getRun(runId);
  return loaded.ok ? loaded.data.currentStage : null;
}
