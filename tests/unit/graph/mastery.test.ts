import { describe, expect, it } from "vitest";

import { honourAdvanceRequest, honourMastery, loadState } from "@/lib/graph/nodes";
import { MASTERY_MIN_TURNS } from "@/learning/progression";
import { initialState } from "@/lib/graph/state";
import { INPUT, fakeGraph, type FakeOptions } from "./fixtures";
import type { LearnerState } from "@/domain/learner";

/**
 * The gate a learner does not have to ask to open.
 *
 * The decision itself — five evaluated turns, four in five error-free — is
 * pure arithmetic tested with the progression engine. What is tested here is
 * the wiring: that the gate reads the stored tally, opens before a word is
 * written, defers to an explicit request, and never takes a turn down.
 */

async function turnWith(options: FakeOptions = {}, message = INPUT.message) {
  const graph = fakeGraph({ ...options, message });
  const loaded = await loadState(initialState({ ...INPUT, message }), graph.deps);
  const before = loaded.learner?.state.miniLevel ?? 0;
  const asked = await honourAdvanceRequest(loaded, graph.deps);
  const state = await honourMastery(asked, graph.deps);
  const note = state.notes.find((entry) => entry.node === "mastery");

  return { state, note, graph, before };
}

const MASTERED = { turns: 5, strongTurns: 4 };

describe("when the tally shows mastery", () => {
  it("moves them up one level", async () => {
    const { state, note, before } = await turnWith({ tally: MASTERED });

    expect(note?.outcome).toBe("ok");
    expect(state.learner?.state.miniLevel).toBe(before + 1);
  });

  it("writes the move down", async () => {
    const { graph, before } = await turnWith({ tally: MASTERED });
    const written = graph.upsertedStates as LearnerState[];

    expect(written).toHaveLength(1);
    expect(written[0]?.miniLevel).toBe(before + 1);
  });

  it("records the level as earned, never as skipped", async () => {
    const { graph, before } = await turnWith({ tally: MASTERED });
    const written = graph.upsertedStates as LearnerState[];

    expect(written[0]?.skippedMiniLevels).not.toContain(before);
  });

  it("tells the tutor it was earned, so the reply congratulates", async () => {
    const { state } = await turnWith({ tally: MASTERED });

    expect(state.learner?.context.justMoved).toBe("earned");
  });

  it("answers from the level they arrive at", async () => {
    const { state, before } = await turnWith({ tally: MASTERED });

    expect(state.learner?.context.miniLevel).toBe(before + 1);
    expect(state.learner?.context.theme).toBe(state.learner?.miniLevel.theme);
  });
});

describe("when the evidence is not there yet", () => {
  it("waits for the minimum number of evaluated turns, however good they were", async () => {
    // Two flawless sentences are a mood, not mastery.
    const { note, graph } = await turnWith({
      tally: { turns: MASTERY_MIN_TURNS - 1, strongTurns: MASTERY_MIN_TURNS - 1 },
    });

    expect(note?.outcome).toBe("skipped");
    expect(graph.upsertedStates).toHaveLength(0);
  });

  it("waits below four in five", async () => {
    const { note, graph } = await turnWith({ tally: { turns: 5, strongTurns: 3 } });

    expect(note?.outcome).toBe("skipped");
    expect(graph.upsertedStates).toHaveLength(0);
  });

  it("stays put at a level nobody has spoken at", async () => {
    const { note, graph } = await turnWith();

    expect(note?.outcome).toBe("skipped");
    expect(graph.upsertedStates).toHaveLength(0);
  });
});

describe("one move per turn", () => {
  it("stands down when the learner already asked to move this turn", async () => {
    // Mastered AND asked must not mean two levels at once.
    const { state, note, before } = await turnWith({ tally: MASTERED }, "weiter");

    expect(note?.outcome).toBe("skipped");
    expect(note?.detail).toContain("already moved");
    expect(state.learner?.state.miniLevel).toBe(before + 1);
    expect(state.learner?.context.justMoved).toBe("asked");
  });
});

describe("when it cannot be done", () => {
  it("stays put when the tally cannot be read", async () => {
    // Unreadable evidence is not evidence.
    const { note, graph } = await turnWith({
      tally: MASTERED,
      tallyReadFails: true,
    });

    expect(note?.outcome).toBe("degraded");
    expect(graph.upsertedStates).toHaveLength(0);
  });

  it("still answers the learner if the write fails", async () => {
    const { state, note, before } = await turnWith({
      tally: MASTERED,
      upsertFails: true,
    });

    expect(note?.outcome).toBe("degraded");
    expect(state.learner?.state.miniLevel).toBe(before);
  });

  it("skips without a learner rather than throwing", async () => {
    const graph = fakeGraph({ learnerMissing: true });
    const loaded = await loadState(initialState(INPUT), graph.deps);

    const state = await honourMastery(loaded, graph.deps);

    expect(state.notes.find((n) => n.node === "mastery")?.outcome).toBe("skipped");
  });
});
