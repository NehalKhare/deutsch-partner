import {
  evaluate,
  generate,
  honourAdvanceRequest,
  honourMastery,
  loadState,
  loadThread,
  persistEvaluation,
  recordPerformance,
  recordVocabulary,
  retrieve,
  type GraphDeps,
} from "@/lib/graph/nodes";
import { initialState, ran, type TurnInput, type TurnState } from "@/lib/graph/state";
import { nullLogger } from "@/lib/observability/logger";

/**
 * One learner turn, start to end.
 *
 *   load state → verify thread → move on if asked → move up if earned →
 *   retrieve → generate → (stream) → evaluate
 *                                    → persist evaluation
 *                                    → record vocabulary
 *                                    → record performance
 *
 * Split at the stream. Everything before it has to finish before the learner
 * sees a word; everything after it runs once the reply is complete, which is
 * what makes evaluation on a second model affordable at all.
 *
 * What is deliberately absent: persistence of the conversation. The
 * transcript arrives from the client, lives in the client, and dies with the
 * tab — the graph reads it from the input and writes down only what the
 * evaluation learned about the learner and how the turn counted towards the
 * level's tally. There is no table it could write a message to.
 *
 * The runner threads state and stops for exactly two failures: a learner
 * whose profile could not be loaded has no level and therefore no policy, no
 * budget and no curriculum; and a thread that does not exist for this learner
 * is a request nothing authorized. Every other node degrades.
 */

export type TurnFailure =
  | "learner_unavailable"
  | "thread_unavailable"
  | "generation_failed";

export interface OpenedTurn {
  readonly state: TurnState;
  /** The reply as it arrives. Nothing after this runs until it is drained. */
  readonly chunks: AsyncIterable<string>;
  /**
   * Resolves once the stream has finished and the after-stream nodes have run.
   * A caller that only wants the reply may ignore it; a caller that wants the
   * turn accounted for must await it.
   */
  readonly completed: Promise<TurnState>;
}

export type TurnOutcome =
  | { readonly ok: true; readonly turn: OpenedTurn }
  | {
      readonly ok: false;
      readonly reason: TurnFailure;
      readonly state: TurnState;
    };

/** What has to succeed before the learner sees anything. */
export async function prepareTurn(
  input: TurnInput,
  deps: GraphDeps,
): Promise<TurnState> {
  let state = initialState(input);

  state = await loadState(state, deps);
  if (!ran(state, "load_state")) return state;

  state = await loadThread(state, deps);
  if (!ran(state, "load_thread")) return state;

  // Both moves run before retrieval, so a learner who moves this turn is
  // retrieved for and answered at the level they arrive at, not the one they
  // left. Asking is checked first and wins; the mastery gate then stands down
  // for this turn, because one move per turn is as fast as a syllabus should
  // travel.
  state = await honourAdvanceRequest(state, deps);
  state = await honourMastery(state, deps);

  return retrieve(state, deps);
}

export async function runTurn(
  input: TurnInput,
  deps: GraphDeps,
): Promise<TurnOutcome> {
  const logger = deps.logger ?? nullLogger;
  const prepared = await prepareTurn(input, deps);

  if (!ran(prepared, "load_state")) {
    return { ok: false, reason: "learner_unavailable", state: prepared };
  }
  if (!ran(prepared, "load_thread")) {
    return { ok: false, reason: "thread_unavailable", state: prepared };
  }

  const opened = await generate(prepared, deps);
  if (!opened.turn) {
    return { ok: false, reason: "generation_failed", state: opened.state };
  }

  const turn = opened.turn;

  /**
   * Runs once the stream is done.
   *
   * Nothing here touches the reply beyond remembering it in turn state for
   * the logs' word counts — the conversation is the client's to keep. What is
   * written is what was learned: the evaluation's observations, and this
   * turn's line in the level tally that the mastery gate reads next turn.
   */
  const completed = (async (): Promise<TurnState> => {
    const reply = await turn.settled;
    let state: TurnState = {
      ...opened.state,
      costEur: opened.state.costEur + reply.costEur,
      reply: { text: reply.text, truncated: reply.truncated },
    };

    state = await evaluate(state, deps);
    state = await persistEvaluation(state, deps);
    state = await recordVocabulary(state, deps);
    state = await recordPerformance(state, deps);

    logger.info("turn.completed", {
      requestId: input.requestId,
      threadId: input.threadId,
      userIdHash: input.userIdHash,
      intent: state.intent,
      retrieved: state.knowledge?.length ?? 0,
      truncated: reply.truncated,
      costEur: Number(state.costEur.toFixed(8)),
      nodes: state.notes
        .map((entry) => `${entry.node}:${entry.outcome}`)
        .join(","),
    });

    return state;
  })();

  // Never let an unobserved rejection take the process down; the promise is
  // returned and a caller may or may not await it.
  completed.catch(() => undefined);

  return { ok: true, turn: { state: opened.state, chunks: turn.chunks, completed } };
}
