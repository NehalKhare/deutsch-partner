import { describe, expect, it } from "vitest";

import { honourAdvanceRequest, loadState } from "@/lib/graph/nodes";
import { initialState } from "@/lib/graph/state";
import { INPUT, fakeGraph } from "./fixtures";
import type { LearnerState } from "@dp/domain/learner";

/**
 * Moving a learner on because they asked.
 *
 * The decision is deterministic and the move is a pure function; what is
 * tested here is the wiring — that it happens before the tutor writes a word,
 * that it is written down, and that it never takes a turn down with it.
 */

async function turnSaying(message: string, options = {}) {
  const graph = fakeGraph({ ...options, message });
  const loaded = await loadState(initialState({ ...INPUT, message }), graph.deps);
  // Relative to wherever the fixture learner happens to be, so the test says
  // "one level on" rather than restating a number from another file.
  const before = loaded.learner?.state.miniLevel ?? 0;
  const state = await honourAdvanceRequest(loaded, graph.deps);
  const note = state.notes.find((entry) => entry.node === "advance");

  return { state, note, graph, before };
}

const written = (graph: ReturnType<typeof fakeGraph>): LearnerState[] =>
  graph.upsertedStates as LearnerState[];

describe("when the learner asks to move on", () => {
  it("moves them exactly one level", async () => {
    const { state, note, before } = await turnSaying("I want to move to next");

    expect(note?.outcome).toBe("ok");
    expect(state.learner?.state.miniLevel).toBe(before + 1);
  });

  it("writes it down, rather than moving them only for this turn", async () => {
    const { graph, before } = await turnSaying("weiter");

    expect(written(graph)).toHaveLength(1);
    expect(written(graph)[0]?.miniLevel).toBe(before + 1);
  });

  it("records the level left behind as skipped, not mastered", async () => {
    const { graph, before } = await turnSaying("next please");

    expect(written(graph)[0]?.skippedMiniLevels).toEqual([before]);
  });

  it("answers from the level they moved to, not the one they left", async () => {
    // The point of running before generation: a reply written from the old
    // level would teach the thing they just said they were finished with.
    const { state, before } = await turnSaying("move me on");

    expect(state.learner?.context.miniLevel).toBe(before + 1);
    expect(state.learner?.context.theme).toBe(state.learner?.miniLevel.theme);
  });

  it("tells the tutor it was asked for, so the reply welcomes rather than congratulates", async () => {
    const { state } = await turnSaying("let's move on");

    expect(state.learner?.context.justMoved).toBe("asked");
  });
});

describe("when the learner is just talking", () => {
  it("leaves them where they are", async () => {
    const { state, note, graph, before } = await turnSaying("Hallo! Wie geht es dir?");

    expect(note?.outcome).toBe("skipped");
    expect(state.learner?.state.miniLevel).toBe(before);
    expect(written(graph)).toHaveLength(0);
  });

  it("does not move somebody asking what a word means", async () => {
    // "Was heißt weitermachen?" is a vocabulary question. Answering it by
    // taking away their place in the syllabus would be a strange reply.
    const { note, graph } = await turnSaying("Was heißt weitermachen auf Englisch?");

    expect(note?.outcome).toBe("skipped");
    expect(written(graph)).toHaveLength(0);
  });

  it("says nothing to the tutor about a move that did not happen", async () => {
    const { state } = await turnSaying("Ich wohne in Berlin.");

    expect(state.learner?.context.justMoved).toBeNull();
  });
});

describe("when it cannot be done", () => {
  it("still answers the learner if the write fails", async () => {
    // A turn is not worth failing over a level that did not move. The learner
    // gets their reply; the note records that the move was lost.
    const { state, note, before } = await turnSaying("weiter", { upsertFails: true });

    expect(note?.outcome).toBe("degraded");
    expect(state.learner).not.toBeNull();
    expect(state.learner?.state.miniLevel).toBe(before);
  });

  it("skips without a learner rather than throwing", async () => {
    const graph = fakeGraph({ learnerMissing: true });
    const loaded = await loadState(initialState(INPUT), graph.deps);

    const state = await honourAdvanceRequest(loaded, graph.deps);

    expect(state.notes.find((n) => n.node === "advance")?.outcome).toBe("skipped");
  });
});

describe("what the learner is told", () => {
  it("that they moved on, by asking: the levels, the new theme, and that it was asked for", async () => {
    const { graph, before, state } = await turnSaying("weiter");

    expect(graph.notified).toEqual([
      {
        learnerId: INPUT.learnerId,
        event: {
          kind: "level.advanced",
          from: before,
          to: before + 1,
          theme: state.learner?.miniLevel.theme,
          cefr: state.learner?.cefr,
          earned: false,
        },
      },
    ]);
  });

  it("that they earned it, when the tally had opened the gate", async () => {
    const { graph } = await turnSaying("weiter", { tally: { turns: 12, strongTurns: 11 } });

    expect(graph.notified[0]?.event).toMatchObject({ kind: "level.advanced", earned: true });
  });

  it("nothing when the move was not written", async () => {
    const { graph } = await turnSaying("weiter", { upsertFails: true });

    expect(graph.notified).toEqual([]);
  });

  it("still moves them when the sink is broken", async () => {
    const { state, note, before } = await turnSaying("weiter", { notifyThrows: true });

    expect(note?.outcome).toBe("ok");
    expect(state.learner?.state.miniLevel).toBe(before + 1);
  });
});
