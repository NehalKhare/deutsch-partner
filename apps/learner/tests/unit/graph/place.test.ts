import { describe, expect, it } from "vitest";

import {
  honourAdvanceRequest,
  loadState,
  loadThread,
  standAtThreadPlace,
} from "@/lib/graph/nodes";
import { initialState, type TurnInput } from "@/lib/graph/state";
import { INPUT, fakeGraph, type FakeOptions } from "./fixtures";
import type { LearnerState } from "@dp/domain/learner";

/**
 * Coming back to a thread means coming back to the place.
 *
 * A thread carries the mini-level it was opened at, and a learner reopening
 * their mini-level 12 conversation must be taught level 12 — however far they
 * have walked since. What is tested here is the wiring: the return happens
 * only on a fresh visit, is written down, marks nothing as skipped, and gives
 * the tutor nothing to announce.
 */

/** The fixture learner stands at 26; the thread was opened at 12. */
const THREAD_LEVEL = 12;

async function turnInto(input: TurnInput, options: FakeOptions = {}) {
  const graph = fakeGraph({ ...options, message: input.message });
  let state = await loadState(initialState(input), graph.deps);
  state = await loadThread(state, graph.deps);
  const before = state.learner?.state.miniLevel ?? 0;
  state = await standAtThreadPlace(state, graph.deps);
  const note = state.notes.find((entry) => entry.node === "place");

  return { state, note, graph, before };
}

const FRESH: TurnInput = { ...INPUT, history: [] };

describe("a fresh visit to a thread opened elsewhere", () => {
  it("returns the learner to the thread's own level", async () => {
    const { state, note } = await turnInto(FRESH, { threadMiniLevel: THREAD_LEVEL });

    expect(note?.outcome).toBe("ok");
    expect(state.learner?.state.miniLevel).toBe(THREAD_LEVEL);
  });

  it("writes the return down", async () => {
    const { graph } = await turnInto(FRESH, { threadMiniLevel: THREAD_LEVEL });
    const written = graph.upsertedStates as LearnerState[];

    expect(written).toHaveLength(1);
    expect(written[0]?.miniLevel).toBe(THREAD_LEVEL);
  });

  it("answers from the thread's level, theme and all", async () => {
    const { state } = await turnInto(FRESH, { threadMiniLevel: THREAD_LEVEL });

    expect(state.learner?.context.miniLevel).toBe(THREAD_LEVEL);
    expect(state.learner?.context.theme).toBe(state.learner?.miniLevel.theme);
  });

  it("marks nothing as skipped and keeps the furthest point earned", async () => {
    // Walking back to a shelf is not walking out of a lesson.
    const { graph, before } = await turnInto(FRESH, {
      threadMiniLevel: THREAD_LEVEL,
    });
    const written = (graph.upsertedStates as LearnerState[])[0];

    expect(written?.skippedMiniLevels).toEqual([]);
    expect(written?.furthestMiniLevel).toBeGreaterThanOrEqual(before);
  });

  it("gives the tutor nothing to announce", async () => {
    // The learner has not moved during this conversation; the conversation is
    // where it always was.
    const { state } = await turnInto(FRESH, { threadMiniLevel: THREAD_LEVEL });

    expect(state.learner?.context.justMoved).toBeNull();
  });

  it("lets a 'weiter' said into the fresh visit advance from the place", async () => {
    // Reopening a level-12 thread and asking to move on lands on 13 — not on
    // 27 from wherever the learner last stood.
    const graph = fakeGraph({ threadMiniLevel: THREAD_LEVEL, message: "weiter" });
    let state = await loadState(
      initialState({ ...FRESH, message: "weiter" }),
      graph.deps,
    );
    state = await loadThread(state, graph.deps);
    state = await standAtThreadPlace(state, graph.deps);
    state = await honourAdvanceRequest(state, graph.deps);

    expect(state.learner?.state.miniLevel).toBe(THREAD_LEVEL + 1);
  });
});

describe("when there is nothing to do", () => {
  it("stays put mid-conversation, so a move made inside the thread survives", async () => {
    // INPUT carries history: the conversation is under way, and dragging it
    // back to the thread's opening level would undo any move made inside it.
    const { note, graph, state, before } = await turnInto(INPUT, {
      threadMiniLevel: THREAD_LEVEL,
    });

    expect(note?.outcome).toBe("skipped");
    expect(state.learner?.state.miniLevel).toBe(before);
    expect(graph.upsertedStates).toHaveLength(0);
  });

  it("does not write a move to where the learner already stands", async () => {
    // The default thread was opened where the fixture learner is.
    const { note, graph } = await turnInto(FRESH);

    expect(note?.outcome).toBe("skipped");
    expect(graph.upsertedStates).toHaveLength(0);
  });

  it("skips without a loaded thread rather than guessing", async () => {
    const graph = fakeGraph();
    const loaded = await loadState(initialState(FRESH), graph.deps);

    const state = await standAtThreadPlace(loaded, graph.deps);

    expect(state.notes.find((n) => n.node === "place")?.outcome).toBe("skipped");
    expect(graph.upsertedStates).toHaveLength(0);
  });
});

describe("when it cannot be done", () => {
  it("still answers the learner if the write fails", async () => {
    // A reply from the wrong level beats no reply; the note says what was
    // lost, and the next fresh visit will try the return again.
    const { state, note, before } = await turnInto(FRESH, {
      threadMiniLevel: THREAD_LEVEL,
      upsertFails: true,
    });

    expect(note?.outcome).toBe("degraded");
    expect(state.learner?.state.miniLevel).toBe(before);
  });

  it("skips without a learner rather than throwing", async () => {
    const graph = fakeGraph({ learnerMissing: true });
    let state = await loadState(initialState(FRESH), graph.deps);
    state = await loadThread(state, graph.deps);

    state = await standAtThreadPlace(state, graph.deps);

    expect(state.notes.find((n) => n.node === "place")?.outcome).toBe("skipped");
  });
});
