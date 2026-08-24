import { describe, expect, it } from "vitest";

import { honourAdvanceRequest, loadState } from "@/lib/graph/nodes";
import { initialState } from "@/lib/graph/state";
import { INPUT, fakeGraph, type FakeOptions } from "./fixtures";
import type { LearnerState } from "@/domain/learner";

/**
 * The gate a learner earns — and chooses to walk through.
 *
 * The arithmetic — five evaluated turns, four in five error-free — is pure
 * and tested with the progression engine. What is tested here is the wiring
 * of the choice: mastery by itself moves nobody, and when the learner does
 * ask to move, the tally decides the bookkeeping — a cleared level is left
 * as mastered, an uncleared one as skipped.
 */

async function turnSaying(message: string, options: FakeOptions = {}) {
  const graph = fakeGraph({ ...options, message });
  const loaded = await loadState(initialState({ ...INPUT, message }), graph.deps);
  const before = loaded.learner?.state.miniLevel ?? 0;
  const state = await honourAdvanceRequest(loaded, graph.deps);
  const note = state.notes.find((entry) => entry.node === "advance");

  return { state, note, graph, before };
}

const MASTERED = { turns: 5, strongTurns: 4 };

describe("mastery on its own moves nobody", () => {
  it("leaves a learner with a cleared level exactly where they are", async () => {
    // The gate being open is announced in the chat; walking through it is
    // the learner's decision, not the tally's.
    const { state, note, graph, before } = await turnSaying(
      "Ich fahre morgen nach Berlin.",
      { tally: MASTERED },
    );

    expect(note?.outcome).toBe("skipped");
    expect(state.learner?.state.miniLevel).toBe(before);
    expect(graph.upsertedStates).toHaveLength(0);
    expect(state.learner?.context.justMoved).toBeNull();
  });
});

describe("confirming an earned move", () => {
  it("moves them one level when they ask with the gate open", async () => {
    const { state, note, before } = await turnSaying("weiter", { tally: MASTERED });

    expect(note?.outcome).toBe("ok");
    expect(state.learner?.state.miniLevel).toBe(before + 1);
  });

  it("records the level as mastered, never as skipped", async () => {
    // They cleared it and then said "weiter". Booking that as a walkout
    // because they did not write five more sentences would be a record
    // against them.
    const { graph, before } = await turnSaying("weiter", { tally: MASTERED });
    const written = graph.upsertedStates as LearnerState[];

    expect(written).toHaveLength(1);
    expect(written[0]?.miniLevel).toBe(before + 1);
    expect(written[0]?.skippedMiniLevels).not.toContain(before);
  });

  it("tells the tutor it was earned, so the reply congratulates", async () => {
    const { state } = await turnSaying("weiter", { tally: MASTERED });

    expect(state.learner?.context.justMoved).toBe("earned");
  });
});

describe("asking without the evidence", () => {
  it("still moves them — asking is allowed — but books the level as skipped", async () => {
    const { state, graph, before } = await turnSaying("weiter", {
      tally: { turns: 5, strongTurns: 3 },
    });

    expect(state.learner?.state.miniLevel).toBe(before + 1);
    expect((graph.upsertedStates as LearnerState[])[0]?.skippedMiniLevels).toEqual([
      before,
    ]);
    expect(state.learner?.context.justMoved).toBe("asked");
  });

  it("treats too few evaluated turns the same, however clean they were", async () => {
    // Two flawless sentences are a mood, not mastery.
    const { graph, before } = await turnSaying("weiter", {
      tally: { turns: 2, strongTurns: 2 },
    });

    expect((graph.upsertedStates as LearnerState[])[0]?.skippedMiniLevels).toEqual([
      before,
    ]);
  });
});

describe("the learner's own pass mark", () => {
  it("books the move as earned against the bar they chose", async () => {
    // 3 of 5 error-free clears a 50% bar even though it would not clear the
    // default: the offer the chat showed them is the bar the record keeps.
    const { state, graph, before } = await turnSaying("weiter", {
      tally: { turns: 5, strongTurns: 3 },
      masteryThreshold: 50,
    });

    expect(state.learner?.context.justMoved).toBe("earned");
    expect(
      (graph.upsertedStates as LearnerState[])[0]?.skippedMiniLevels,
    ).not.toContain(before);
  });

  it("holds a relaxed bar to the evidence floor all the same", async () => {
    // 2 of 2 is a perfect score over nothing. Skipped, not earned.
    const { state } = await turnSaying("weiter", {
      tally: { turns: 2, strongTurns: 2 },
      masteryThreshold: 33,
    });

    expect(state.learner?.context.justMoved).toBe("asked");
  });
});

describe("when the tally cannot be read", () => {
  it("honours the request as asked rather than blocking it", async () => {
    // They did ask, and a level wrongly marked skipped is un-skipped the day
    // it is mastered. Refusing the move over a read failure would hold a
    // learner hostage to a database hiccup.
    const { state, before } = await turnSaying("weiter", {
      tally: MASTERED,
      tallyReadFails: true,
    });

    expect(state.learner?.state.miniLevel).toBe(before + 1);
    expect(state.learner?.context.justMoved).toBe("asked");
  });
});
