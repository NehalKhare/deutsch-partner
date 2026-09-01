import { cefrForMiniLevel } from "@/domain/cefr";
import { GRAMMAR_LABELS } from "@/learning/grammar-labels";
import {
  advanceOnMastery,
  advanceOnRequest,
  asksToAdvance,
  hasMastered,
  isStrongTurn,
  switchToMiniLevel,
  type Moved,
} from "@/learning/progression";
import { thresholdRatio } from "@/learning/mastery";
import { getMiniLevel } from "@/learning/mini-levels";
import {
  newLearnerVocabulary,
  recordCorrectUse,
  recordExposure,
  recordIncorrectUse,
  vocabularyOutcomes,
} from "@/learning/vocabulary-engine";
import type { Evaluator } from "@/lib/ai/evaluation";
import type { ModelGateway } from "@/lib/ai/gateway/gateway";
import { callSpecFor } from "@/lib/ai/gateway/call-spec";
import {
  behaviorPolicyFor,
  buildPrompt,
  fingerprint,
  promptEntry,
  versionedText,
  type LearnerContext,
} from "@/lib/ai/prompts";
import { DEFAULT_INTENT, classifyIntent } from "@/lib/graph/intent";
import { note, spend, type LoadedLearner, type TurnState } from "@/lib/graph/state";
import type { GermanLearningRetriever } from "@/lib/retrieval/retriever";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { ConversationRepository } from "@/repositories/conversation-repository";
import type { LearnerErrorRepository } from "@/repositories/learner-error-repository";
import type { LearnerRepository } from "@/repositories/learner-repository";
import type { PerformanceRepository } from "@/repositories/performance-repository";
import type { VocabularyRepository } from "@/repositories/vocabulary-repository";

/**
 * The turn's nodes.
 *
 * Each one takes the state and returns the state. None of them throws: a node
 * that cannot do its job records why and hands the turn on, because a learner
 * who gets a reply with no retrieval behind it is better served than a learner
 * who gets an error page because the vector store was slow.
 *
 * Small on purpose. One "handle the turn" function is untestable in the only
 * way that matters — you cannot ask it what happens when retrieval is empty
 * but the model is fine.
 */

export interface GraphDeps {
  readonly learners: LearnerRepository;
  readonly conversations: ConversationRepository;
  readonly errors: LearnerErrorRepository;
  readonly vocabulary: VocabularyRepository;
  readonly performance: PerformanceRepository;
  readonly retriever: GermanLearningRetriever;
  readonly evaluator: Evaluator;
  readonly gateway: ModelGateway;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

/** Top-K for retrieval. Small, per the context-budget discipline. */
export const RETRIEVAL_TOP_K = 5;

const CONVERSATION_TIMEOUT_MS = 45_000;

const logger = (deps: GraphDeps): Logger => deps.logger ?? nullLogger;

// --- 1: load state ----------------------------------------------------------

/**
 * The compact projection the prompt renders.
 *
 * Built from the curriculum rather than from raw rows: the prompt gets the
 * words and the readable grammar labels for this level, not a join result.
 */
export function learnerContextFor(
  profile: { learningGoal: string; interests: readonly string[] },
  state: { effectiveLevel: LoadedLearner["effectiveLevel"]; miniLevel: number },
  extras: { dueVocabulary: readonly string[]; recurringErrors: readonly string[] },
): LearnerContext {
  const level = getMiniLevel(state.miniLevel);

  return {
    effectiveLevel: state.effectiveLevel,
    miniLevel: state.miniLevel,
    theme: level.theme,
    focus: level.focus,
    learningGoal: profile.learningGoal,
    interests: [...profile.interests].slice(0, 8),
    targetVocabulary: [...level.targetVocabulary].slice(0, 12),
    targetGrammar: level.targetGrammar
      .map((key) => GRAMMAR_LABELS[key] ?? key)
      .slice(0, 6),
    dueVocabulary: [...extras.dueVocabulary].slice(0, 12),
    recurringErrors: [...extras.recurringErrors].slice(0, 5),
    justMoved: null,
  };
}

export async function loadState(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  const [profile, learnerState] = await Promise.all([
    deps.learners.getProfile(state.input.learnerId),
    deps.learners.getState(state.input.learnerId),
  ]);

  if (!profile.ok || !learnerState.ok) {
    // Without a level there is no policy, no budget and no curriculum. This is
    // the one node whose failure ends the turn.
    return note(state, "load_state", "failed", "learner not found");
  }

  const now = deps.now?.() ?? new Date();

  // Both are context, not correctness: a turn without them is thinner, not
  // wrong, so neither failure stops anything.
  const [due, recurring] = await Promise.all([
    deps.vocabulary.listDue(state.input.learnerId, now, 12),
    deps.errors.listUnresolved(state.input.learnerId, 5),
  ]);

  // Resolved to words before they go anywhere near a prompt: a progress row
  // carries the item's id, and a tutor told to "work in naturally" a UUID
  // will gamely try. An unresolvable id is dropped, not rendered.
  const dueItems = due.ok
    ? await deps.vocabulary.findByIds(
        due.data.map((record) => record.vocabularyItemId),
      )
    : due;
  const dueWords = dueItems.ok ? dueItems.data.map((item) => item.word) : [];
  const errorPatterns = recurring.ok
    ? recurring.data.map((record) => record.pattern)
    : [];

  const learner: LoadedLearner = {
    profile: profile.data,
    state: learnerState.data,
    miniLevel: getMiniLevel(learnerState.data.miniLevel),
    effectiveLevel: learnerState.data.effectiveLevel,
    cefr: learnerState.data.effectiveLevel.cefr,
    context: learnerContextFor(
      profile.data,
      learnerState.data,
      { dueVocabulary: dueWords, recurringErrors: errorPatterns },
    ),
  };

  return note({ ...state, learner }, "load_state", "ok");
}

// --- 2: verify the thread -----------------------------------------------------

/**
 * Confirms the thread the body names exists and is the caller's.
 *
 * The transcript itself arrives from the client — nothing in the database
 * holds one — so this is the authorization step the old message write used to
 * be: the read runs as the signed-in learner and Row Level Security decides
 * whether the row exists for them. Somebody else's thread id, or an invented
 * one, reads as not found, and the turn never reaches a model.
 */
export async function loadThread(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  const thread = await deps.conversations.getThread(state.input.threadId);

  if (!thread.ok) {
    return note(state, "load_thread", "failed", thread.error.kind);
  }

  // The level the thread was opened at rides along: it is the place a fresh
  // visit to this conversation returns the learner to.
  return note(
    { ...state, thread: { miniLevel: thread.data.miniLevel } },
    "load_thread",
    "ok",
  );
}

// --- 2.4: stand where this conversation lives ---------------------------------

/**
 * Returns the learner to the level this thread was opened at.
 *
 * A thread carries its mini-level, and the product promises that coming back
 * to a thread means coming back to the place: a learner standing at
 * mini-level 5 who reopens their mini-level 1 conversation is taught level 1
 * in it — not level 5 under a level-1 title.
 *
 * Only on a fresh visit. The transcript lives in the learner's browser and
 * dies with the tab, so an empty history is the reliable mark of one; a turn
 * that carries history is a conversation already under way, and dragging it
 * back to its opening level would undo any move made inside it.
 *
 * The same pure function as the curriculum page's "Start here" button, so it
 * marks nothing as skipped. The tutor is told nothing: the learner has not
 * moved during this conversation — the conversation is where it always was.
 */
export async function standAtThreadPlace(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  if (!state.learner) return note(state, "place", "skipped", "no learner");
  if (!state.thread) return note(state, "place", "skipped", "no thread");
  if ((state.history ?? []).length > 0) {
    return note(state, "place", "skipped", "conversation under way");
  }

  const moved = switchToMiniLevel(state.learner.state, state.thread.miniLevel);
  if (!moved) return note(state, "place", "skipped", "already there");

  return applyMove(state, deps, moved, null, "place");
}

// --- 2.5: honour an explicit request to move on -----------------------------

/**
 * Moves the learner on when their message asked to.
 *
 * Deterministic, and it has to be: the routing document names mini-level
 * progression and level advancement gating as work that must never be a model
 * call, and a learner's message is untrusted input. So a pattern decides
 * whether a request was made, and a pure function decides what happens — the
 * tutor is told about the move afterwards and never asked to make it.
 *
 * Every move goes through here, including an earned one. Mastery does not
 * move anybody by itself any more — the tally opening the gate is announced
 * in the chat, and the learner chooses between moving on and staying to
 * practise. What the tally still decides is the bookkeeping: a learner who
 * cleared the level and then confirms the move has earned it, and recording
 * that as a walkout because they said "weiter" instead of writing five more
 * sentences would be a record against them. An unreadable tally moves them
 * as asked — they did ask — and a level wrongly marked skipped is un-skipped
 * the day it is mastered.
 *
 * It runs before generation so the reply is written from the new level rather
 * than about it. A failure here is not a failed turn: the learner still gets
 * an answer, just at the level they were already on.
 */
export async function honourAdvanceRequest(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  if (!state.learner) return note(state, "advance", "skipped", "no learner");
  if (!asksToAdvance(state.input.message)) {
    return note(state, "advance", "skipped", "not asked");
  }

  const tally = await deps.performance.getForLevel(
    state.input.learnerId,
    state.learner.state.miniLevel,
  );
  // Against the learner's own pass mark, not the default: the bar they chose
  // in settings is the bar the offer in the chat showed them.
  const mastered =
    tally.ok &&
    tally.data !== null &&
    hasMastered(tally.data, thresholdRatio(state.learner.profile.masteryThreshold));

  const moved = mastered
    ? advanceOnMastery(state.learner.state)
    : advanceOnRequest(state.learner.state);
  if (!moved) {
    // The end of the path. Saying so is the tutor's job; this only records
    // that there was nowhere to go.
    return note(state, "advance", "skipped", "end of path");
  }

  return applyMove(state, deps, moved, mastered ? "earned" : "asked", "advance");
}

/**
 * Writes a move down and rebuilds the loaded learner around it.
 *
 * Shared by the two ways a learner moves mid-turn — asking, and earning —
 * because the bookkeeping is identical and the difference (what the tutor is
 * told) is one word. The tutor is told as a fact in the learner's state,
 * never as an instruction: the move has already been made by the time a
 * prompt is built.
 */
async function applyMove(
  state: TurnState,
  deps: GraphDeps,
  moved: Moved,
  because: "asked" | "earned" | null,
  node: string,
): Promise<TurnState> {
  if (!state.learner) return note(state, node, "skipped", "no learner");

  const saved = await deps.learners.upsertState(moved.state);
  if (!saved.ok) {
    return note(state, node, "degraded", saved.error.kind);
  }

  const learner: LoadedLearner = {
    ...state.learner,
    state: saved.data,
    miniLevel: moved.level,
    effectiveLevel: saved.data.effectiveLevel,
    cefr: saved.data.effectiveLevel.cefr,
    context: {
      ...state.learner.context,
      effectiveLevel: saved.data.effectiveLevel,
      miniLevel: moved.to,
      theme: moved.level.theme,
      focus: moved.level.focus,
      targetVocabulary: [...moved.level.targetVocabulary].slice(0, 12),
      targetGrammar: moved.level.targetGrammar
        .map((key) => GRAMMAR_LABELS[key] ?? key)
        .slice(0, 6),
      justMoved: because,
    },
  };

  return note({ ...state, learner }, node, "ok", `${moved.from}->${moved.to}`);
}

// --- 3: retrieve ------------------------------------------------------------

export async function retrieve(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  if (!state.learner) return note(state, "retrieve", "skipped", "no learner");

  const intent = classifyIntent(state.input.message) ?? DEFAULT_INTENT;

  const outcome = await deps.retriever.retrieve(
    state.input.message,
    {
      intent,
      cefr: state.learner.cefr,
      miniLevel: state.learner.state.miniLevel,
      weakGrammarKeys: [...state.learner.miniLevel.targetGrammar],
      targetVocabularyLemmas: [...state.learner.miniLevel.targetVocabulary],
    },
    {
      topK: RETRIEVAL_TOP_K,
      context: { requestId: state.input.requestId, userIdHash: state.input.userIdHash },
    },
  );

  if (!outcome.ok) {
    // A thinner reply, not a failed one.
    return note({ ...state, intent, knowledge: [] }, "retrieve", "degraded", outcome.failure);
  }

  return note(
    spend({ ...state, intent, knowledge: outcome.data.chunks }, outcome.data.costEur),
    "retrieve",
    "ok",
  );
}

// --- 4: generate ------------------------------------------------------------

export interface GeneratedTurn {
  readonly chunks: AsyncIterable<string>;
  readonly settled: Promise<{ text: string; truncated: boolean; costEur: number }>;
}

/**
 * Opens the streamed reply.
 *
 * Returns the stream rather than the text: the learner should see the first
 * words as they arrive, and everything after this node runs once the stream
 * has finished.
 */
export async function generate(
  state: TurnState,
  deps: GraphDeps,
): Promise<{ state: TurnState; turn: GeneratedTurn | null }> {
  if (!state.learner) {
    return { state: note(state, "generate", "failed", "no learner"), turn: null };
  }

  const entry = promptEntry("conversation.turn");
  const policy = behaviorPolicyFor({
    cefr: state.learner.cefr,
    correctionPreference: state.learner.profile.correctionPreference,
  });

  const built = buildPrompt(entry, {
    policy,
    cefr: state.learner.cefr,
    learner: state.learner.context,
    knowledge: (state.knowledge ?? []).map((chunk) => ({
      content: chunk.content,
      // Clamped: the retriever's score is a weighted sum, and the prompt
      // block's schema wants a plain relevance in the unit interval.
      score: Math.max(0, Math.min(1, chunk.score)),
      source: chunk.contentType,
    })),
    recentMessages: [...(state.history ?? [])],
    userMessage: state.input.message,
  });

  if (!built.ok) {
    return {
      state: note(state, "generate", "failed", built.reason),
      turn: null,
    };
  }

  const spec = callSpecFor("conversation.turn", {
    level: state.learner.cefr,
    timeoutMs: CONVERSATION_TIMEOUT_MS,
  });
  if (!spec.ok) {
    return { state: note(state, "generate", "failed", spec.detail), turn: null };
  }

  const opened = await deps.gateway.stream(
    spec.data,
    {
      system: built.prompt.system,
      systemStable: built.prompt.systemStable,
      user: built.prompt.user,
      inputTokens: built.prompt.tokens.total,
    },
    {
      requestId: state.input.requestId,
      traceId: state.input.traceId ?? null,
      userIdHash: state.input.userIdHash,
      threadId: state.input.threadId,
      prompt: {
        name: entry.name,
        version: entry.version,
        fingerprint: fingerprint(versionedText(built.prompt)),
      },
    },
  );

  if (!opened.ok) {
    return { state: note(state, "generate", "failed", opened.failure), turn: null };
  }

  return {
    state: note(state, "generate", "ok"),
    turn: {
      chunks: opened.data.chunks,
      settled: opened.data.settled.then((outcome) => ({
        text: outcome.text,
        truncated: outcome.truncated,
        costEur: outcome.costEur,
      })),
    },
  };
}

// --- 5: evaluate ------------------------------------------------------------

export async function evaluate(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  if (!state.learner) return note(state, "evaluate", "skipped", "no learner");

  const outcome = await deps.evaluator.evaluateLearnerMessage(
    {
      learnerMessage: state.input.message,
      cefr: state.learner.cefr,
      precedingTurns: (state.history ?? []).slice(-2),
    },
    {
      requestId: state.input.requestId,
      traceId: state.input.traceId ?? null,
      userIdHash: state.input.userIdHash,
      threadId: state.input.threadId,
    },
  );

  if (outcome.status === "skipped") {
    return note(state, "evaluate", "skipped", outcome.reason);
  }

  if (outcome.status === "failed") {
    // Nothing is written. The learner's stored state stands, which is the
    // safe answer when the alternative is fabricated progress.
    return note(spend(state, outcome.costEur), "evaluate", "failed", outcome.reason);
  }

  return note(
    spend({ ...state, evaluation: outcome.evaluation }, outcome.costEur),
    "evaluate",
    outcome.recovered ? "degraded" : "ok",
    outcome.recovered ? "recovered" : undefined,
  );
}

// --- 6: persist what was learned, never what was said ------------------------

/**
 * Writes what the evaluation observed.
 *
 * Errors go through the aggregating function, which is the only thing that can
 * merge a recurring mistake atomically. The level estimate moves learner state
 * only through the domain's own derivation, never by assignment.
 */
export async function persistEvaluation(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  if (!state.evaluation || !state.learner) {
    return note(state, "persist_evaluation", "skipped", "nothing to write");
  }

  const observedAt = deps.now?.() ?? new Date();
  let failures = 0;

  for (const error of state.evaluation.errors) {
    const recorded = await deps.errors.record({
      learnerId: state.input.learnerId,
      errorType: error.errorType,
      pattern: error.explanation,
      utterance: error.excerpt,
      observedAt,
    });
    if (!recorded.ok) failures += 1;
  }

  const updated = await deps.learners.upsertState(
    nextLearnerState(state.learner.state, state.evaluation),
  );

  if (!updated.ok) failures += 1;

  return note(
    state,
    "persist_evaluation",
    failures === 0 ? "ok" : "degraded",
    failures === 0 ? undefined : `${failures} writes failed`,
  );
}

/**
 * Moves each observed word's record the way the evaluation observed it.
 *
 * This is where the review ladder and the dashboard's vocabulary figures get
 * their data — the machinery below (mastery curves, scheduling, status) sat
 * complete and unreachable, because nothing wrote a row. The mapping from an
 * evaluation to outcomes is deterministic and bounded; only words the
 * curriculum actually teaches are tracked, because the lemma has to resolve
 * to a catalogue item before anything is written.
 *
 * Failures degrade word by word: one unwritable record costs that word's
 * update, never the turn and never the other words.
 */
export async function recordVocabulary(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  if (!state.learner) {
    return note(state, "record_vocabulary", "skipped", "no learner");
  }
  if (!state.evaluation) {
    return note(state, "record_vocabulary", "skipped", "no evaluation");
  }

  const outcomes = vocabularyOutcomes(state.evaluation);
  if (outcomes.size === 0) {
    return note(state, "record_vocabulary", "skipped", "nothing observed");
  }

  const items = await deps.vocabulary.findByLemmas([...outcomes.keys()]);
  if (!items.ok) {
    return note(state, "record_vocabulary", "degraded", items.error.kind);
  }
  if (items.data.length === 0) {
    return note(state, "record_vocabulary", "skipped", "no curriculum words");
  }

  const existing = await deps.vocabulary.listByItems(
    state.input.learnerId,
    items.data.map((item) => item.id),
  );
  if (!existing.ok) {
    return note(state, "record_vocabulary", "degraded", existing.error.kind);
  }

  const byItem = new Map(existing.data.map((record) => [record.vocabularyItemId, record]));
  const now = deps.now?.() ?? new Date();
  let failures = 0;

  for (const item of items.data) {
    const outcome = outcomes.get(item.lemma);
    if (!outcome) continue;

    const record =
      byItem.get(item.id) ?? newLearnerVocabulary(state.input.learnerId, item.id);
    const next =
      outcome === "correct"
        ? recordCorrectUse(record, now)
        : outcome === "incorrect"
          ? recordIncorrectUse(record, now)
          : recordExposure(record, now);

    const saved = await deps.vocabulary.upsertLearnerVocabulary(next);
    if (!saved.ok) failures += 1;
  }

  return note(
    state,
    "record_vocabulary",
    failures === 0 ? "ok" : "degraded",
    failures === 0 ? `${items.data.length} words` : `${failures} writes failed`,
  );
}

/**
 * Adds this turn to the level's tally.
 *
 * One row per learner per mini-level: how many evaluated turns, how many the
 * evaluation found no errors in. This is the only trace a conversation leaves
 * in the database — the tally the mastery gate reads next turn — and it holds
 * two integers, never a word of what was said.
 *
 * A turn the evaluator skipped or failed adds nothing. A formulaic "Danke!"
 * is not evidence of mastery, and five of them must not open the gate.
 */
export async function recordPerformance(
  state: TurnState,
  deps: GraphDeps,
): Promise<TurnState> {
  if (!state.learner) {
    return note(state, "record_performance", "skipped", "no learner");
  }
  if (!state.evaluation) {
    return note(state, "record_performance", "skipped", "no evaluation");
  }

  const recorded = await deps.performance.recordTurn(
    state.learner.state.miniLevel,
    isStrongTurn(state.evaluation),
  );

  if (!recorded.ok) {
    logger(deps).error("graph.record_performance_failed", {
      requestId: state.input.requestId,
      userIdHash: state.input.userIdHash,
      errorCode: recorded.error.kind,
    });
    return note(state, "record_performance", "failed", recorded.error.kind);
  }

  // Kept on the turn, not just in the note: the response tells the learner
  // how this turn counted, and the write's own return is the only figure
  // guaranteed to agree with what the mastery gate will read next turn.
  const performance = {
    miniLevel: state.learner.state.miniLevel,
    turns: recorded.data.turns,
    strongTurns: recorded.data.strongTurns,
  };

  return note(
    { ...state, performance },
    "record_performance",
    "ok",
    `${performance.strongTurns}/${performance.turns}`,
  );
}

/**
 * How one message moves a learner's state.
 *
 * A single message is weak evidence, so the skill scores move a fraction of
 * the way towards what was observed rather than jumping to it. The estimated
 * level only moves when the evaluation is confident about it; a low-confidence
 * estimate is noise, and noise that moves a learner's level relabels their
 * whole curriculum.
 */
export const SKILL_BLEND = 0.15;

export const LEVEL_CONFIDENCE_THRESHOLD = 0.7;

export function nextLearnerState(
  current: Parameters<LearnerRepository["upsertState"]>[0],
  evaluation: NonNullable<TurnState["evaluation"]>,
) {
  const blend = (was: number, now: number) =>
    Math.round((was + (now - was) * SKILL_BLEND) * 1000) / 1000;

  const confident = evaluation.levelConfidence >= LEVEL_CONFIDENCE_THRESHOLD;
  const estimatedLevel = confident ? evaluation.estimatedLevel : current.estimatedLevel;

  return {
    ...current,
    estimatedLevel,
    fluency: blend(current.fluency, evaluation.skillEstimates.fluency),
    comprehension: blend(current.comprehension, evaluation.skillEstimates.comprehension),
    confidence: blend(current.confidence, evaluation.skillEstimates.accuracy),
    // The mini-level and the effective level are moved by the progression
    // engine against mastery criteria, never by one message's opinion.
    updatedAt: new Date(),
  };
}

/** Re-exported so the dashboard can name the level a learner is being taught. */
export { cefrForMiniLevel };
