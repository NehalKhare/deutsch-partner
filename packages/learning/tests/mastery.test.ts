import { describe, expect, it } from "vitest";

import {
  MASTERY_MIN_TURNS,
  MASTERY_RATIO,
  hasMastered,
  masteryFill,
  thresholdRatio,
  turnQuality,
} from "../src/mastery";

/**
 * The mastery meter: what the chat page draws.
 *
 * The gate itself (hasMastered, isStrongTurn) is covered with the progression
 * suite; what matters here is that the two display functions never tell a
 * learner a story the gate would contradict.
 */

describe("how full the bar is", () => {
  it("is empty before any turn has been evaluated", () => {
    expect(masteryFill(null)).toBe(0);
    expect(masteryFill({ turns: 0, strongTurns: 0 })).toBe(0);
  });

  it("shows the strong-turn ratio once the evidence floor is met", () => {
    // 4 of 7 strong is ~0.57 against a 0.8 bar.
    expect(masteryFill({ turns: 7, strongTurns: 4 })).toBeCloseTo(4 / 7 / 0.8);
  });

  it("is full exactly when the gate itself would open", () => {
    const cleared = { turns: 7, strongTurns: 6 };
    const short = { turns: 7, strongTurns: 5 };

    expect(masteryFill(cleared)).toBe(1);
    expect(hasMastered(cleared)).toBe(true);
    expect(masteryFill(short)).toBeLessThan(1);
    expect(hasMastered(short)).toBe(false);
  });

  it("never overfills, however clean the run", () => {
    expect(masteryFill({ turns: 10, strongTurns: 10 })).toBe(1);
  });

  it("fills one seventh per error-free turn before the evidence floor", () => {
    // A weak turn adds nothing pre-floor, so an early error never reads as
    // progress — and no run, however clean, is full before seven turns.
    expect(masteryFill({ turns: 2, strongTurns: 2 })).toBeCloseTo(2 / 7);
    expect(masteryFill({ turns: 3, strongTurns: 2 })).toBeCloseTo(2 / 7);
  });

  it("is never full while the gate is shut on the evidence floor", () => {
    // Six clean turns out of six beat every ratio and are still not evidence.
    const tally = { turns: 6, strongTurns: 6 };

    expect(masteryFill(tally)).toBeLessThan(1);
    expect(hasMastered(tally)).toBe(false);
  });

  it("rises on an error-free turn and falls on one with errors", () => {
    const before = { turns: 7, strongTurns: 5 };
    const afterStrong = { turns: 8, strongTurns: 6 };
    const afterWeak = { turns: 8, strongTurns: 5 };

    expect(masteryFill(afterStrong)).toBeGreaterThan(masteryFill(before));
    expect(masteryFill(afterWeak)).toBeLessThan(masteryFill(before));
  });
});

describe("what the newest counted turn was", () => {
  it("names a strong turn when the strong count moved with the total", () => {
    expect(
      turnQuality({ turns: 2, strongTurns: 1 }, { turns: 3, strongTurns: 2 }),
    ).toBe("strong");
  });

  it("names a weak turn when only the total moved", () => {
    expect(
      turnQuality({ turns: 2, strongTurns: 1 }, { turns: 3, strongTurns: 1 }),
    ).toBe("weak");
  });

  it("judges the very first turn at a level from nothing", () => {
    expect(turnQuality(null, { turns: 1, strongTurns: 1 })).toBe("strong");
    expect(turnQuality(null, { turns: 1, strongTurns: 0 })).toBe("weak");
  });

  it("gives no verdict when the tallies are not one turn apart", () => {
    // A reload, a second device, a level move: the state is real, the story
    // "your last message did this" would not be.
    expect(
      turnQuality({ turns: 2, strongTurns: 1 }, { turns: 5, strongTurns: 4 }),
    ).toBeNull();
    expect(
      turnQuality({ turns: 5, strongTurns: 4 }, { turns: 5, strongTurns: 4 }),
    ).toBeNull();
  });
});

describe("the constants the strip leans on", () => {
  it("match the gate the graph enforces", () => {
    // The strip draws MASTERY_MIN_TURNS dots and fills against MASTERY_RATIO.
    // If either moved without the other, the picture would lie about the gate.
    expect(MASTERY_RATIO).toBe(0.8);
    expect(MASTERY_MIN_TURNS).toBe(7);
  });
});

describe("the learner's own pass mark", () => {
  it("turns the stored percentage into the ratio the gate compares", () => {
    expect(thresholdRatio(80)).toBe(0.8);
    expect(thresholdRatio(50)).toBe(0.5);
    expect(thresholdRatio(33)).toBe(0.33);
  });

  it("opens the gate at a lower bar when the learner set one", () => {
    const tally = { turns: 7, strongTurns: 4 };

    expect(hasMastered(tally)).toBe(false);
    expect(hasMastered(tally, thresholdRatio(50))).toBe(true);
  });

  it("keeps the evidence floor whatever the bar", () => {
    // Two clean turns out of two beats every ratio — and still is not
    // evidence. The seven-turn minimum is not the learner's to lower.
    const tally = { turns: 2, strongTurns: 2 };

    expect(hasMastered(tally, thresholdRatio(33))).toBe(false);
  });

  it("fills the bar against the learner's own target", () => {
    // 4 of 7 strong is ~0.57: part-way up an 80% bar, full at 50%.
    const tally = { turns: 7, strongTurns: 4 };

    expect(masteryFill(tally, thresholdRatio(80))).toBeCloseTo(4 / 7 / 0.8);
    expect(masteryFill(tally, thresholdRatio(50))).toBe(1);
  });
});
