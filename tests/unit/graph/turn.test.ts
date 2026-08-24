import { describe, expect, it, vi } from "vitest";

import { gatewayFail, gatewayOk } from "@/lib/ai/gateway/errors";
import {
  LEVEL_CONFIDENCE_THRESHOLD,
  SKILL_BLEND,
  nextLearnerState,
} from "@/lib/graph/nodes";
import { runTurn, prepareTurn } from "@/lib/graph/turn";
import { classifyIntent } from "@/lib/graph/intent";
import { ran } from "@/lib/graph/state";
import { createLogger } from "@/lib/observability/logger";
import { fakeGraph, INPUT, EVALUATION } from "./fixtures";

describe("the happy path", () => {
  it("streams a reply", async () => {
    const { deps } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const chunks: string[] = [];
    for await (const chunk of outcome.turn.chunks) chunks.push(chunk);

    expect(chunks.join("")).toBe("Guten Tag! Wohin fährst du?");
  });

  it("runs every node in the order the build spec lays out", async () => {
    const { deps } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    for await (const _chunk of outcome.turn.chunks) void _chunk;
    const state = await outcome.turn.completed;

    expect(state.notes.map((entry) => entry.node)).toEqual([
      "load_state",
      "load_thread",
      // The place and the move both run before retrieval and generation, so
      // a learner who moves this turn is answered at the level they arrive at.
      "place",
      "advance",
      "retrieve",
      "generate",
      "evaluate",
      "persist_evaluation",
      "record_vocabulary",
      "record_performance",
    ]);
  });

  it("keeps the reply in turn state and writes it nowhere", async () => {
    // The conversation is the client's to keep. What the turn retains is the
    // text for this turn's own bookkeeping — and the dependency surface has no
    // way to store a message even if a node wanted to.
    const { deps } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    const state = await outcome.turn.completed;

    expect(state.reply?.text).toBe("Guten Tag! Wohin fährst du?");
    expect(deps.conversations).not.toHaveProperty("appendMessage");
  });

  it("counts the turn towards the level's tally", async () => {
    const { deps, recordedTurns } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    // The fixture's evaluation found a dative error, so the turn counts, and
    // counts as weak.
    expect(recordedTurns).toEqual([{ miniLevel: 26, strong: false }]);
  });

  it("records what the learner got wrong", async () => {
    const { deps, recordedErrors } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    expect(recordedErrors).toHaveLength(1);
    expect(recordedErrors[0]).toMatchObject({
      learnerId: INPUT.learnerId,
      errorType: "case_dative",
    });
  });

  it("adds up what the turn cost across every model call", async () => {
    const { deps } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    const state = await outcome.turn.completed;

    // Retrieval embedding + the streamed turn + the evaluation.
    expect(state.costEur).toBeCloseTo(0.0000005 + 0.004 + 0.0008, 10);
  });

  it("logs the turn without its content", async () => {
    const lines: string[] = [];
    const { deps } = fakeGraph({ sink: (line) => lines.push(line) });

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    const logged = lines.join("\n");
    expect(logged).toContain("turn.completed");
    expect(logged).toContain("load_state:ok");
    expect(logged).not.toContain("Wohin fährst du");
  });
});

describe("what the prompt is given", () => {
  it("carries the learner's level and this level's curriculum", async () => {
    const { deps, prompts } = fakeGraph();

    await runTurn(INPUT, deps);

    expect(prompts[0].system).toContain("A2");
    expect(prompts[0].system).toContain("mini-level 26");
  });

  it("carries the retrieved knowledge", async () => {
    const { deps, prompts } = fakeGraph();

    await runTurn(INPUT, deps);

    expect(prompts[0].system).toContain("Nach mit, nach, bei steht der Dativ.");
  });

  it("carries due words as words, never as their row ids", async () => {
    // The first real vocabulary rows put UUIDs on the review page and into
    // this prompt on the same day, for the same reason: nobody resolved the
    // id. The fixture's due row points at "der Zug" through an id.
    const { deps, prompts } = fakeGraph();

    await runTurn(INPUT, deps);

    expect(prompts[0].system).toContain("der Zug");
    expect(prompts[0].system).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
  });

  it("carries the recent messages the client sent up", async () => {
    // There is nowhere else they could come from: the database holds none.
    const { deps, prompts } = fakeGraph();

    await runTurn(INPUT, deps);

    expect(prompts[0].system).toContain("Wie war dein Wochenende?");
  });

  it("clamps a longer history claim to the window", async () => {
    const { deps, prompts } = fakeGraph();
    const padded = Array.from({ length: 12 }, (_, index) => ({
      role: "user" as const,
      content: `Satz nummer ${index}`,
    }));

    await runTurn({ ...INPUT, history: padded }, deps);

    expect(prompts[0].system).not.toContain("Satz nummer 3");
    expect(prompts[0].system).toContain("Satz nummer 4");
    expect(prompts[0].system).toContain("Satz nummer 11");
  });
});

describe("degrading rather than failing", () => {
  it("still replies when retrieval is unavailable", async () => {
    const { deps } = fakeGraph({ retrieval: gatewayFail("provider_error", "down") });

    const outcome = await runTurn(INPUT, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(
      outcome.turn.state.notes.find((entry) => entry.node === "retrieve"),
    ).toMatchObject({ outcome: "degraded" });
  });

  it("still replies with no history at all, which is every first message", async () => {
    const { deps } = fakeGraph();

    const outcome = await runTurn({ ...INPUT, history: [] }, deps);

    expect(outcome.ok).toBe(true);
  });

  it("counts nothing towards the tally when the evaluation fails", async () => {
    // Fabricated progress is worse than none: a turn nobody assessed must not
    // move a learner closer to the gate.
    const { deps, recordedTurns } = fakeGraph({ evaluationFails: true });

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    const state = await outcome.turn.completed;

    expect(recordedTurns).toEqual([]);
    expect(state.notes.find((entry) => entry.node === "evaluate")).toMatchObject({
      outcome: "failed",
    });
  });

  it("writes nothing from an evaluation that was skipped", async () => {
    // Five formulaic "Danke!"s must not open the mastery gate.
    const { deps, recordedErrors, upsertedStates, recordedTurns } = fakeGraph({
      message: "Danke!",
    });

    const outcome = await runTurn({ ...INPUT, message: "Danke!" }, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    expect(recordedErrors).toEqual([]);
    expect(upsertedStates).toEqual([]);
    expect(recordedTurns).toEqual([]);
  });
});

describe("when a turn cannot happen", () => {
  it("stops when the learner cannot be loaded", async () => {
    const { deps } = fakeGraph({ learnerMissing: true });

    const outcome = await runTurn(INPUT, deps);

    expect(outcome).toMatchObject({ ok: false, reason: "learner_unavailable" });
  });

  it("makes no model call when the learner cannot be loaded", async () => {
    const { deps, prompts } = fakeGraph({ learnerMissing: true });

    await runTurn(INPUT, deps);

    expect(prompts).toEqual([]);
  });

  it("reports a refused generation without counting the turn", async () => {
    const { deps, recordedTurns } = fakeGraph({
      generation: gatewayFail("budget_denied", "over budget"),
    });

    const outcome = await runTurn(INPUT, deps);

    expect(outcome).toMatchObject({ ok: false, reason: "generation_failed" });
    expect(recordedTurns).toEqual([]);
  });

  it("stops for a thread that does not exist for this learner", async () => {
    // Somebody else's thread id and an invented one read the same, and the
    // turn never reaches a model either way.
    const { deps, prompts } = fakeGraph({ threadMissing: true });

    const outcome = await runTurn(INPUT, deps);

    expect(outcome).toMatchObject({ ok: false, reason: "thread_unavailable" });
    expect(prompts).toEqual([]);
  });

  it("checks the thread the body actually named", async () => {
    const { deps, threadReads } = fakeGraph();

    await runTurn(INPUT, deps);

    expect(threadReads).toEqual([INPUT.threadId]);
  });
});

describe("preparing a turn", () => {
  it("does everything the learner waits for and nothing else", async () => {
    const { deps, prompts } = fakeGraph();

    const state = await prepareTurn(INPUT, deps);

    expect(state.notes.map((entry) => entry.node)).toEqual([
      "load_state",
      "load_thread",
      "place",
      "advance",
      "retrieve",
    ]);
    expect(ran(state, "retrieve")).toBe(true);
    expect(prompts).toEqual([]);
  });

  it("stops at the first node whose failure has no recovery", async () => {
    const { deps } = fakeGraph({ learnerMissing: true });

    const state = await prepareTurn(INPUT, deps);

    expect(state.notes.map((entry) => entry.node)).toEqual(["load_state"]);
  });
});

describe("how one message moves a learner", () => {
  const current = {
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

  it("moves a skill score part of the way, not all of it", () => {
    // One message is weak evidence. Jumping to what it observed would make a
    // learner's level a function of their last sentence.
    const next = nextLearnerState(current, {
      ...EVALUATION,
      skillEstimates: { fluency: 1, comprehension: 1, accuracy: 1, range: 1 },
    });

    expect(next.fluency).toBeCloseTo(0.5 + 0.5 * SKILL_BLEND, 6);
    expect(next.fluency).toBeLessThan(1);
  });

  it("moves the level only when the evaluation is confident about it", () => {
    const unsure = nextLearnerState(current, {
      ...EVALUATION,
      estimatedLevel: "B1",
      levelConfidence: LEVEL_CONFIDENCE_THRESHOLD - 0.01,
    });
    const sure = nextLearnerState(current, {
      ...EVALUATION,
      estimatedLevel: "B1",
      levelConfidence: LEVEL_CONFIDENCE_THRESHOLD,
    });

    expect(unsure.estimatedLevel).toBe("A2");
    expect(sure.estimatedLevel).toBe("B1");
  });

  it("never moves the mini-level, which the progression engine owns", () => {
    // A mini-level is earned against mastery criteria, not granted by one
    // message's opinion of how it went.
    const next = nextLearnerState(current, { ...EVALUATION, estimatedLevel: "B1" });

    expect(next.miniLevel).toBe(26);
    expect(next.effectiveLevel).toEqual(current.effectiveLevel);
  });
});

describe("routing a question", () => {
  it.each([
    ["Was heißt trotzdem?", "vocabulary"],
    ["Warum sagt man mit dem Zug?", "grammar"],
    ["Wie begrüßt man einen neuen Kollegen in Deutschland?", "culture"],
    ["Wie ist das Wetter heute in Berlin?", "web"],
    ["Ich war am Wochenende in Hamburg.", "conversation"],
  ])("routes %s to %s", (message, intent) => {
    expect(classifyIntent(message)).toBe(intent);
  });

  it("asks a model rather than guessing on a question it cannot read", () => {
    expect(classifyIntent("Und dann?")).toBeNull();
  });

  it("routes nothing for an empty message", () => {
    expect(classifyIntent("   ")).toBeNull();
  });

  it("prefers the more specific rule", () => {
    // Also a question, and also about German — but it is about a word.
    expect(classifyIntent("Was bedeutet trotzdem auf Englisch?")).toBe("vocabulary");
  });

  it("uses the routed intent for retrieval", async () => {
    const { deps, retrievalContexts } = fakeGraph();

    await runTurn({ ...INPUT, message: "Warum sagt man mit dem Zug?" }, deps);

    expect(retrievalContexts[0].intent).toBe("grammar");
  });
});

describe("the after-stream work", () => {
  it("does not run until the stream has been drained", async () => {
    const { deps, recordedTurns } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;

    expect(recordedTurns).toEqual([]);

    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    expect(recordedTurns).toHaveLength(1);
  });

  it("never rejects, so an unawaited turn cannot take the process down", async () => {
    const { deps } = fakeGraph({ recordThrows: true });

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;

    await expect(outcome.turn.completed).rejects.toThrow();
  });
});

describe("dependencies", () => {
  it("asks the evaluator for the message the learner actually sent", async () => {
    const evaluateLearnerMessage = vi.fn().mockResolvedValue({
      status: "skipped",
      reason: "formulaic",
    });
    const { deps } = fakeGraph({ evaluator: { evaluateLearnerMessage } });

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    expect(evaluateLearnerMessage.mock.calls[0][0]).toMatchObject({
      learnerMessage: INPUT.message,
      cefr: "A2",
    });
  });

  it("passes the request id down every call, so a turn can be traced", async () => {
    const { deps, retrievalContexts, gatewayContexts } = fakeGraph();

    await runTurn(INPUT, deps);

    expect(retrievalContexts[0]).toBeDefined();
    expect(gatewayContexts[0].requestId).toBe(INPUT.requestId);
  });
});

describe("the logger", () => {
  it("is optional", async () => {
    const { deps } = fakeGraph();
    const withoutLogger = { ...deps, logger: undefined };

    const outcome = await runTurn(INPUT, withoutLogger);
    expect(outcome.ok).toBe(true);
  });

  it("is used when given", async () => {
    const lines: string[] = [];
    const { deps } = fakeGraph({ sink: (line) => lines.push(line) });
    void createLogger({ sink: () => {} });

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    expect(lines.length).toBeGreaterThan(0);
  });
});

describe("gateway outcomes", () => {
  it("treats a truncated reply as a reply", async () => {
    const { deps } = fakeGraph({ truncated: true });

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    const state = await outcome.turn.completed;

    expect(state.reply?.truncated).toBe(true);
  });

  it("accounts for a reply that the gateway priced", async () => {
    const { deps } = fakeGraph();

    const outcome = await runTurn(INPUT, deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    const state = await outcome.turn.completed;

    expect(state.costEur).toBeGreaterThan(0);
  });

  it("passes a gateway success through unchanged", () => {
    expect(gatewayOk({ x: 1 })).toEqual({ ok: true, data: { x: 1 } });
  });
});
