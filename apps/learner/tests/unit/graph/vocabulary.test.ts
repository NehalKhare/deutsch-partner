import { describe, expect, it } from "vitest";

import { runTurn } from "@/lib/graph/turn";
import { EVALUATION, INPUT, fakeGraph, type FakeOptions } from "./fixtures";

/**
 * The turn writing down what the evaluation saw of each word.
 *
 * The mastery curves, the review ladder and the dashboard's vocabulary
 * figures all read from learner_vocabulary — and until this node existed,
 * nothing had ever written a row to it. What matters here is the wiring:
 * that observed words land, that untracked words are left alone, and that a
 * failure costs a word, never the turn.
 */

async function completedTurn(options: FakeOptions = {}) {
  const graph = fakeGraph(options);
  const outcome = await runTurn(INPUT, graph.deps);
  if (!outcome.ok) throw new Error("the turn should have opened");
  for await (const _chunk of outcome.turn.chunks) void _chunk;
  const state = await outcome.turn.completed;
  const note = state.notes.find((entry) => entry.node === "record_vocabulary");

  return { graph, state, note };
}

describe("after an evaluated turn", () => {
  it("writes a record for each word the curriculum tracks", async () => {
    // The fixture evaluation used "fahren", which the catalogue knows.
    const { graph, note } = await completedTurn();

    expect(note?.outcome).toBe("ok");
    expect(graph.vocabularyWrites).toHaveLength(1);
    expect(graph.vocabularyWrites[0]).toMatchObject({
      learnerId: INPUT.learnerId,
      vocabularyItemId: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("counts the fixture's clean use of the word as a correct use", async () => {
    const { graph } = await completedTurn();

    expect(graph.vocabularyWrites[0]).toMatchObject({
      correctCount: 1,
      incorrectCount: 0,
      exposureCount: 1,
    });
  });

  it("counts a word the evaluation flagged as an incorrect use", async () => {
    const { graph } = await completedTurn({
      evaluator: {
        evaluateLearnerMessage: async () => ({
          status: "evaluated",
          evaluation: { ...EVALUATION, vocabularyWeaknesses: ["fahren"] },
          recovered: false,
          repairs: [],
          attempts: 1,
          costEur: 0.0008,
        }),
      },
    });

    expect(graph.vocabularyWrites[0]).toMatchObject({
      correctCount: 0,
      incorrectCount: 1,
    });
  });

  it("schedules the word for review rather than filing it away", async () => {
    const { graph } = await completedTurn();
    const written = graph.vocabularyWrites[0] as { nextReviewAt: Date | null };

    expect(written.nextReviewAt).toBeInstanceOf(Date);
  });

  it("leaves words the curriculum does not teach alone", async () => {
    const { graph, note } = await completedTurn({
      evaluator: {
        evaluateLearnerMessage: async () => ({
          status: "evaluated",
          evaluation: { ...EVALUATION, vocabularyUsed: ["die Quintessenz"], masterySignals: [] },
          recovered: false,
          repairs: [],
          attempts: 1,
          costEur: 0.0008,
        }),
      },
    });

    expect(note?.outcome).toBe("skipped");
    expect(graph.vocabularyWrites).toHaveLength(0);
  });
});

describe("when it cannot be done", () => {
  it("writes nothing from an evaluation that was skipped", async () => {
    // Formulaic one-worders are skipped by the evaluator, and a turn nobody
    // assessed says nothing about any word.
    const graph = fakeGraph({ message: "Danke!" });
    const outcome = await runTurn({ ...INPUT, message: "Danke!" }, graph.deps);
    if (!outcome.ok) return;
    for await (const _chunk of outcome.turn.chunks) void _chunk;
    await outcome.turn.completed;

    expect(graph.vocabularyWrites).toHaveLength(0);
  });

  it("degrades when the catalogue cannot be read, and the turn survives", async () => {
    const { note, state } = await completedTurn({ vocabularyFails: true });

    expect(note?.outcome).toBe("degraded");
    expect(state.reply?.text.length).toBeGreaterThan(0);
  });

  it("degrades when a write fails, and still counts the level tally", async () => {
    const { note, graph } = await completedTurn({ vocabularyWriteFails: true });

    expect(note?.outcome).toBe("degraded");
    expect(graph.recordedTurns).toHaveLength(1);
  });
});
