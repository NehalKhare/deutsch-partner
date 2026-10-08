import { vi } from "vitest";

import type { LearningEvaluation } from "@dp/domain/evaluation";
import type { Evaluator } from "@/lib/ai/evaluation";
import { gatewayOk, type GatewayResult } from "@dp/gateway/errors";
import type { GatewayPrompt, ModelGateway } from "@dp/gateway/gateway";
import type { GraphDeps } from "@/lib/graph/nodes";
import type { TurnInput } from "@/lib/graph/state";
import { createLogger } from "@dp/observability/logger";
import type { GermanLearningRetriever } from "@/lib/retrieval/retriever";

/**
 * A whole turn's dependencies, in memory.
 *
 * The point of the graph's shape is that this is possible: no database, no
 * network, and every node's failure independently switchable.
 */

export const INPUT: TurnInput = {
  learnerId: "11111111-1111-4111-8111-111111111111",
  threadId: "22222222-2222-4222-8222-222222222222",
  message: "Ich fahre morgen mit den Zug nach Berlin.",
  // The transcript as the client resends it. There is nowhere else it could
  // come from: the database holds no messages.
  history: [
    { role: "assistant" as const, content: "Wie war dein Wochenende?" },
    { role: "user" as const, content: "Gut, danke." },
  ],
  requestId: "33333333-3333-4333-8333-333333333333",
  userIdHash: "hash-alice",
};

export const EVALUATION: LearningEvaluation = {
  estimatedLevel: "A2",
  levelConfidence: 0.6,
  vocabularyUsed: ["fahren"],
  vocabularyWeaknesses: [],
  grammarPatternsUsed: ["dative_prepositions"],
  errors: [
    {
      errorType: "case_dative",
      excerpt: "mit den Zug",
      corrected: "mit dem Zug",
      explanation: "mit takes the dative.",
    },
  ],
  skillEstimates: { fluency: 0.6, comprehension: 0.6, accuracy: 0.5, range: 0.4 },
  masterySignals: [{ lemma: "fahren", direction: "up" }],
  reviewCandidates: [],
  recommendationSignals: [],
};

const PROFILE = {
  id: INPUT.learnerId,
  learningGoal: "Talk to colleagues in German",
  selectedLevel: "A2" as const,
  targetTopics: ["travel"],
  interests: ["travel"],
  inputPreference: "text" as const,
  outputPreference: "text" as const,
  correctionPreference: "gentle" as const,
  masteryThreshold: 80 as const,
};

const STATE = {
  learnerId: INPUT.learnerId,
  selectedLevel: "A2" as const,
  estimatedLevel: "A2" as const,
  effectiveLevel: { cefr: "A2" as const, plus: false },
  miniLevel: 26,
  furthestMiniLevel: 26,
  skippedMiniLevels: [],
  fluency: 0.5,
  comprehension: 0.5,
  confidence: 0.5,
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const CHUNK = {
  id: 1,
  documentId: 1,
  content: "Nach mit, nach, bei steht der Dativ.",
  score: 0.8,
  cefr: "A2" as const,
  miniLevel: 26,
  contentType: "grammar",
  grammarTarget: "dative_prepositions",
};

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = () => ({
  ok: false as const,
  error: { kind: "unavailable" as const, message: "no", name: "RepositoryError" },
});

export interface FakeOptions {
  readonly learnerMissing?: boolean;
  readonly threadMissing?: boolean;
  readonly retrieval?: GatewayResult<never>;
  readonly generation?: GatewayResult<never>;
  readonly evaluationFails?: boolean;
  readonly evaluator?: Partial<Evaluator>;
  readonly replyText?: string;
  readonly truncated?: boolean;
  readonly upsertFails?: boolean;
  /** The stored tally the mastery gate will read for the current level. */
  readonly tally?: { turns: number; strongTurns: number };
  readonly tallyReadFails?: boolean;
  /** The level the thread was opened at; defaults to where the learner is. */
  readonly threadMiniLevel?: number;
  /** The thread's mode and title; a scenario thread is a roleplay or a reading. */
  readonly threadMode?: "free_chat" | "roleplay" | "reading";
  readonly threadTitle?: string;
  /** The learner's chosen pass mark, as a percentage. Defaults to 80. */
  readonly masteryThreshold?: number;
  readonly recordFails?: boolean;
  readonly recordThrows?: boolean;
  readonly vocabularyFails?: boolean;
  readonly vocabularyWriteFails?: boolean;
  readonly message?: string;
  readonly sink?: (line: string) => void;
  /** The notification sink refuses, as a broken store would. */
  readonly notifyThrows?: boolean;
}

export function fakeGraph(options: FakeOptions = {}) {
  const recordedErrors: Record<string, unknown>[] = [];
  const recordedTurns: Array<{ miniLevel: number; strong: boolean }> = [];
  const vocabularyWrites: Record<string, unknown>[] = [];
  const upsertedStates: unknown[] = [];
  const threadReads: string[] = [];
  const prompts: GatewayPrompt[] = [];
  const gatewayContexts: Record<string, unknown>[] = [];
  const gatewaySpecs: Record<string, unknown>[] = [];
  const retrievalContexts: Record<string, unknown>[] = [];
  const retrievalOptions: Record<string, unknown>[] = [];
  const evaluationContexts: Record<string, unknown>[] = [];
  const notified: Array<{ learnerId: string; event: Record<string, unknown> }> = [];

  const replyText = options.replyText ?? "Guten Tag! Wohin fährst du?";

  const gateway: ModelGateway = {
    async complete() {
      throw new Error("the graph streams its turn");
    },
    async stream(spec, prompt, context) {
      prompts.push(prompt);
      gatewaySpecs.push(spec as unknown as Record<string, unknown>);
      gatewayContexts.push(context as unknown as Record<string, unknown>);

      if (options.generation) return options.generation;

      // Settled only once the stream is drained, as the real gateway does:
      // the after-stream nodes must not be able to run early.
      let finish: (value: unknown) => void = () => {};
      const settled = new Promise<never>((resolve) => {
        finish = resolve as (value: unknown) => void;
      });

      async function* chunks() {
        try {
          if (replyText.length > 0) yield replyText;
        } finally {
          finish({
            text: replyText,
            truncated: options.truncated ?? false,
            degraded: false,
            tier: "strong",
            modelIdResolved: "vendor/model",
            inputTokens: 900,
            outputTokens: 120,
            costUsd: 0.0044,
            costEur: 0.004,
            attempts: 1,
            ledgerId: 1,
            citations: [],
          });
        }
      }

      return gatewayOk({
        chunks: chunks(),
        settled,
        tier: "strong" as const,
        degraded: false,
      });
    },
  };

  const retriever: GermanLearningRetriever = {
    async retrieve(_message, context, asked) {
      retrievalContexts.push(context as Record<string, unknown>);
      retrievalOptions.push((asked ?? {}) as Record<string, unknown>);
      if (options.retrieval) return options.retrieval;

      return gatewayOk({
        chunks: [CHUNK],
        considered: 1,
        costEur: 0.0000005,
        ranked: [],
      });
    },
  };

  const evaluator: Evaluator = {
    evaluateLearnerMessage:
      options.evaluator?.evaluateLearnerMessage ??
      (async (request, context) => {
        evaluationContexts.push(context as unknown as Record<string, unknown>);
        if (/^danke/iu.test(request.learnerMessage.trim())) {
          return { status: "skipped", reason: "formulaic" };
        }
        if (options.evaluationFails) {
          return {
            status: "failed",
            reason: "unusable_output",
            detail: "no",
            attempts: 2,
            costEur: 0.0008,
          };
        }
        return {
          status: "evaluated",
          evaluation: EVALUATION,
          recovered: false,
          repairs: [],
          attempts: 1,
          costEur: 0.0008,
        };
      }),
  };

  const deps: GraphDeps = {
    learners: {
      getProfile: vi.fn(async () =>
        options.learnerMissing
          ? fail()
          : ok({
              ...PROFILE,
              masteryThreshold: options.masteryThreshold ?? PROFILE.masteryThreshold,
            }),
      ),
      getState: vi.fn(async () => (options.learnerMissing ? fail() : ok(STATE))),
      upsertProfile: vi.fn(async () => ok(PROFILE)),
      upsertState: vi.fn(async (state: unknown) => {
        upsertedStates.push(state);
        // Echoed, not swapped for the fixture: a node that reads back its own
        // write would otherwise see the state it was trying to change.
        return options.upsertFails ? fail() : ok(state);
      }),
    } as unknown as GraphDeps["learners"],

    conversations: {
      getThread: vi.fn(async (threadId: string) => {
        threadReads.push(threadId);
        if (options.threadMissing) {
          return {
            ok: false as const,
            error: { kind: "not_found" as const, message: "no", name: "RepositoryError" },
          };
        }
        return ok({
          id: threadId,
          learnerId: INPUT.learnerId,
          miniLevel: options.threadMiniLevel ?? STATE.miniLevel,
          mode: options.threadMode ?? "free_chat",
          title: options.threadTitle ?? "Reisen",
        });
      }),
    } as unknown as GraphDeps["conversations"],

    performance: {
      getForLevel: vi.fn(async () => {
        if (options.tallyReadFails) return fail();
        return ok(
          options.tally
            ? {
                learnerId: INPUT.learnerId,
                miniLevel: STATE.miniLevel,
                turns: options.tally.turns,
                strongTurns: options.tally.strongTurns,
                score: options.tally.turns
                  ? options.tally.strongTurns / options.tally.turns
                  : 0,
                updatedAt: new Date("2026-08-20T00:00:00.000Z"),
              }
            : null,
        );
      }),
      recordTurn: vi.fn(async (miniLevel: number, strong: boolean) => {
        if (options.recordThrows) throw new Error("connection reset");
        if (options.recordFails) return fail();
        recordedTurns.push({ miniLevel, strong });
        const turns = recordedTurns.length;
        const strongTurns = recordedTurns.filter((t) => t.strong).length;
        return ok({
          learnerId: INPUT.learnerId,
          miniLevel,
          turns,
          strongTurns,
          score: strongTurns / turns,
          updatedAt: new Date("2026-08-21T00:00:00.000Z"),
        });
      }),
    } as unknown as GraphDeps["performance"],

    errors: {
      listUnresolved: vi.fn(async () =>
        ok([{ pattern: "uses the accusative after mit" }]),
      ),
      record: vi.fn(async (observation: Record<string, unknown>) => {
        recordedErrors.push(observation);
        return ok("55555555-5555-4555-8555-555555555555");
      }),
    } as unknown as GraphDeps["errors"],

    vocabulary: {
      listDue: vi.fn(async () =>
        ok([{ vocabularyItemId: "88888888-8888-4888-8888-888888888888" }]),
      ),
      findByIds: vi.fn(async (ids: readonly string[]) =>
        ok(
          ids.includes("88888888-8888-4888-8888-888888888888")
            ? [{ id: "88888888-8888-4888-8888-888888888888", lemma: "Zug", word: "der Zug" }]
            : [],
        ),
      ),
      // The catalogue knows "fahren" and nothing else, so a test can tell a
      // tracked word from one the curriculum does not teach.
      findByLemmas: vi.fn(async (lemmas: readonly string[]) =>
        options.vocabularyFails
          ? fail()
          : ok(
              lemmas.includes("fahren")
                ? [{ id: "77777777-7777-4777-8777-777777777777", lemma: "fahren" }]
                : [],
            ),
      ),
      listByItems: vi.fn(async () => ok([])),
      upsertLearnerVocabulary: vi.fn(async (record: Record<string, unknown>) => {
        if (options.vocabularyWriteFails) return fail();
        vocabularyWrites.push(record);
        return ok(record);
      }),
    } as unknown as GraphDeps["vocabulary"],

    retriever,
    evaluator,
    gateway,
    notifications: {
      async notify(learnerId: string, event: Record<string, unknown>) {
        if (options.notifyThrows) throw new Error("sink down");
        notified.push({ learnerId, event });
      },
    },
    logger: createLogger({ sink: options.sink ?? (() => {}) }),
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  };

  return {
    deps,
    notified,
    recordedErrors,
    recordedTurns,
    vocabularyWrites,
    upsertedStates,
    threadReads,
    prompts,
    gatewayContexts,
    gatewaySpecs,
    retrievalContexts,
    retrievalOptions,
    evaluationContexts,
  };
}
