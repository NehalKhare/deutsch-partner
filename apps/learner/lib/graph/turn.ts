import {
  evaluate,
  generate,
  honourAdvanceRequest,
  loadState,
  loadThread,
  persistEvaluation,
  recordPerformance,
  recordVocabulary,
  retrieve,
  standAtThreadPlace,
  type GraphDeps,
} from "@/lib/graph/nodes";
import { initialState, ran, type TurnInput, type TurnState } from "@/lib/graph/state";
import type { BudgetScope } from "@dp/domain/budgets";
import { nullLogger } from "@dp/observability/logger";

/**
 * One learner turn, start to end.
 *
 *   load state → verify thread → (admission) → return to the thread's place →
 *   move on if asked → retrieve → generate → (stream) → evaluate
 *                                            → persist evaluation
 *                                            → record vocabulary
 *                                            → record performance
 *
 * Mastery moves nobody by itself. The tally opening the gate is announced in
 * the chat, and the learner chooses between moving on and staying — the move,
 * when they confirm it, arrives as an ordinary request and is recorded as
 * earned because the tally says so.
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
  | "generation_failed"
  /** The learner's own euro allowance is spent (billing-and-plans-spec.md S9). */
  | "budget_exhausted"
  /** The admission said no: a plan's daily quota, or its store being down. */
  | "not_admitted";

/**
 * The plan's say on a turn that is otherwise going ahead — its daily quota,
 * counted by the caller. Asked once the learner is loaded and the thread is
 * theirs, and before anything is moved, retrieved or generated, so a turn
 * that could never have happened has used nothing.
 */
export type TurnAdmission = () => Promise<
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly refusal: "plan_required" | "quota_exhausted" | "unavailable";
      readonly resetAt: Date | null;
    }
>;

export type TurnRefusal = Extract<Awaited<ReturnType<TurnAdmission>>, { allowed: false }>;

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
      /** Which of the learner's scopes was spent, on a budget_exhausted only. */
      readonly budgetScope?: BudgetScope;
      /** What the admission answered, on a not_admitted only. */
      readonly refusal?: TurnRefusal;
    };

/** The two reads a turn cannot go ahead without: the learner, and a thread that is theirs. */
async function openTurn(input: TurnInput, deps: GraphDeps): Promise<TurnState> {
  const state = await loadState(initialState(input), deps);
  if (!ran(state, "load_state")) return state;
  return loadThread(state, deps);
}

/** Everything after the two reads that still comes before the first word. */
async function readyTurn(opened: TurnState, deps: GraphDeps): Promise<TurnState> {
  // Both moves run before retrieval, so a learner who moves this turn is
  // retrieved for and answered at the level they arrive at, not the one they
  // left. The place comes first: a fresh visit to a thread returns to the
  // level it was opened at, and a "weiter" said into that visit advances
  // from there rather than from wherever the learner last stood.
  let state = await standAtThreadPlace(opened, deps);
  state = await honourAdvanceRequest(state, deps);

  return retrieve(state, deps);
}

/** What has to succeed before the learner sees anything. */
export async function prepareTurn(
  input: TurnInput,
  deps: GraphDeps,
): Promise<TurnState> {
  const opened = await openTurn(input, deps);
  if (!ran(opened, "load_state") || !ran(opened, "load_thread")) return opened;
  return readyTurn(opened, deps);
}

export async function runTurn(
  input: TurnInput,
  deps: GraphDeps,
  admit?: TurnAdmission,
): Promise<TurnOutcome> {
  const logger = deps.logger ?? nullLogger;
  const loaded = await openTurn(input, deps);

  if (!ran(loaded, "load_state")) {
    return { ok: false, reason: "learner_unavailable", state: loaded };
  }
  if (!ran(loaded, "load_thread")) {
    return { ok: false, reason: "thread_unavailable", state: loaded };
  }

  if (admit) {
    const admission = await admit();
    if (!admission.allowed) return { ok: false, reason: "not_admitted", refusal: admission, state: loaded };
  }

  const prepared = await readyTurn(loaded, deps);

  const opened = await generate(prepared, deps);
  if (!opened.turn) {
    return opened.allowanceSpent
      ? {
          ok: false,
          reason: "budget_exhausted",
          budgetScope: opened.allowanceSpent,
          state: opened.state,
        }
      : { ok: false, reason: "generation_failed", state: opened.state };
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
