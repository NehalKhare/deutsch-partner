import { describe, expect, it } from "vitest";

import { MAX_MINI_LEVEL, miniLevelRangeFor } from "@dp/domain/cefr";
import { learnerStateSchema, type LearnerState } from "@dp/domain/learner";
import {
  MASTERY_MIN_TURNS,
  switchToMiniLevel,
  MASTERY_RATIO,
  advanceOnMastery,
  advanceOnRequest,
  asksToAdvance,
  hasMastered,
  isAtLevel,
  isStrongTurn,
  miniLevelForLevel,
  switchToLevel,
  wasSkipped,
} from "../src/progression";

/**
 * Moving a learner along the path.
 *
 * Everything here is a pure function over learner state, which is what the
 * routing document requires: mini-level progression and level advancement
 * gating are named as work that must never be a model call.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";

function stateAt(miniLevel: number, over: Partial<LearnerState> = {}): LearnerState {
  const cefr = miniLevel <= 15 ? "A1" : miniLevel <= 35 ? "A2" : "B1";

  return learnerStateSchema.parse({
    learnerId: LEARNER,
    selectedLevel: cefr,
    estimatedLevel: null,
    effectiveLevel: { cefr, plus: false },
    miniLevel,
    furthestMiniLevel: miniLevel,
    skippedMiniLevels: [],
    fluency: 0.4,
    comprehension: 0.4,
    confidence: 0.4,
    updatedAt: new Date("2026-08-22T00:00:00.000Z"),
    ...over,
  });
}

describe("where a chosen level puts a learner", () => {
  it.each([
    ["A1", 1],
    ["A2", 16],
    ["B1", 36],
  ] as const)("starts a learner who has never been there at the top of %s", (level, first) => {
    expect(miniLevelForLevel(level, 1)).toBe(level === "A1" ? 1 : first);
  });

  it("returns a learner to where they left the level", () => {
    // The whole point of remembering: somebody on mini-level 30 who looks at
    // A1 for five minutes has not given up twelve levels of position.
    expect(miniLevelForLevel("A2", 30)).toBe(30);
  });

  it("puts a learner who has moved past a level at the end of it", () => {
    // They finished A1; the last A1 level is where they left it.
    expect(miniLevelForLevel("A1", 40)).toBe(miniLevelRangeFor("A1").last);
  });

  it("never lands outside the level's own range", () => {
    for (const level of ["A1", "A2", "B1"] as const) {
      const { first, last } = miniLevelRangeFor(level);
      for (const furthest of [1, 15, 16, 35, 36, 70]) {
        const landed = miniLevelForLevel(level, furthest);
        expect(landed).toBeGreaterThanOrEqual(first);
        expect(landed).toBeLessThanOrEqual(last);
      }
    }
  });
});

describe("choosing a level", () => {
  it("moves the learner and says where to", () => {
    const moved = switchToLevel(stateAt(3), "A2");

    expect(moved?.to).toBe(16);
    expect(moved?.from).toBe(3);
    expect(moved?.level.cefr).toBe("A2");
  });

  it("produces a state the schema and the database will both accept", () => {
    // The mini-level and the effective level are checked against each other in
    // two places. A move that changes one without the other is a failed write.
    const moved = switchToLevel(stateAt(3), "B1");

    expect(() => learnerStateSchema.parse(moved?.state)).not.toThrow();
    expect(moved?.state.effectiveLevel.cefr).toBe("B1");
    expect(moved?.state.selectedLevel).toBe("B1");
  });

  it("does nothing when the learner is already there", () => {
    // A no-op must be distinguishable, or the product announces a move that
    // did not happen and writes a row that changed nothing.
    expect(switchToLevel(stateAt(20), "A2")).toBeNull();
  });

  it("clears an estimate that is about somewhere else", () => {
    // The estimate is evidence about the learner's writing. After a deliberate
    // move it is evidence about a level they have left, and it would also make
    // the state unwritable, since the effective level derives from it first.
    const moved = switchToLevel(
      stateAt(3, { estimatedLevel: "A1", confidence: 0.9 }),
      "B1",
    );

    expect(moved?.state.estimatedLevel).toBeNull();
    expect(moved?.state.effectiveLevel).toEqual({ cefr: "B1", plus: false });
  });

  it("remembers the furthest point, so going back and forth costs nothing", () => {
    const up = switchToLevel(stateAt(3), "B1");
    const down = switchToLevel(up!.state, "A1");
    const back = switchToLevel(down!.state, "B1");

    expect(down?.to).toBe(15);
    // Asserted at the bottom of the trip, not only at the end of it: a
    // high-water mark that follows the learner down is not a high-water mark,
    // and by the time they come back up it looks the same either way.
    expect(down?.state.furthestMiniLevel).toBe(36);
    expect(back?.to).toBe(36);
    expect(back?.state.furthestMiniLevel).toBe(36);
  });

  it("keeps the mark where it was when a learner drops back a level", () => {
    const dropped = switchToLevel(stateAt(40, { furthestMiniLevel: 40 }), "A2");

    expect(dropped?.to).toBe(35);
    expect(dropped?.state.furthestMiniLevel).toBe(40);
  });

  it("does not record a chosen level as skipped", () => {
    // Choosing a level is not walking past one. Only an explicit "move me on"
    // leaves a level behind unmastered.
    const moved = switchToLevel(stateAt(3), "A2");

    expect(moved?.state.skippedMiniLevels).toEqual([]);
  });

  it("leaves what the learner knows alone", () => {
    const before = stateAt(3, { fluency: 0.8, comprehension: 0.7 });
    const moved = switchToLevel(before, "A2");

    expect(moved?.state.fluency).toBe(0.8);
    expect(moved?.state.comprehension).toBe(0.7);
  });

  it("knows when a learner is already at a level", () => {
    expect(isAtLevel(stateAt(20), "A2")).toBe(true);
    expect(isAtLevel(stateAt(20), "B1")).toBe(false);
  });
});

describe("picking an exact mini-level off the syllabus", () => {
  it("puts the learner exactly there", () => {
    const moved = switchToMiniLevel(stateAt(2), 40);

    expect(moved?.to).toBe(40);
    expect(moved?.state.miniLevel).toBe(40);
    expect(moved?.level.miniLevel).toBe(40);
  });

  it("keeps the whole state agreeing about the band", () => {
    const moved = switchToMiniLevel(stateAt(2), 40);

    expect(moved?.state.effectiveLevel.cefr).toBe("B1");
    expect(learnerStateSchema.safeParse(moved?.state).success).toBe(true);
  });

  it("marks nothing as skipped, in either direction", () => {
    // Walking to a shelf is not walking out of a lesson.
    expect(switchToMiniLevel(stateAt(2), 40)?.state.skippedMiniLevels).toEqual([]);
    expect(switchToMiniLevel(stateAt(40), 2)?.state.skippedMiniLevels).toEqual([]);
  });

  it("raises the high-water mark going forward and keeps it going back", () => {
    expect(switchToMiniLevel(stateAt(2), 40)?.state.furthestMiniLevel).toBe(40);
    expect(
      switchToMiniLevel(stateAt(30, { furthestMiniLevel: 30 }), 5)?.state
        .furthestMiniLevel,
    ).toBe(30);
  });

  it("clears the estimate, which was evidence about somewhere else", () => {
    const moved = switchToMiniLevel(stateAt(20, { estimatedLevel: "A2" }), 50);

    expect(moved?.state.estimatedLevel).toBeNull();
  });

  it("returns null for the level they are already standing on", () => {
    expect(switchToMiniLevel(stateAt(26), 26)).toBeNull();
  });

  it("says what moved, for something that has to explain it", () => {
    expect(switchToMiniLevel(stateAt(26), 30)).toMatchObject({ from: 26, to: 30 });
  });
});

describe("what the schema will not hold", () => {
  it("refuses a learner standing further along than they have ever been", () => {
    // The column is only useful if it cannot lie. A row where the mark is
    // behind the position would silently send a returning learner backwards.
    const invalid = { ...stateAt(20), furthestMiniLevel: 5 };

    expect(learnerStateSchema.safeParse(invalid).success).toBe(false);
  });

  it("refuses the same level skipped twice", () => {
    const invalid = { ...stateAt(20), skippedMiniLevels: [3, 3] };

    expect(learnerStateSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a mark ahead of the position, which is the ordinary case", () => {
    expect(
      learnerStateSchema.safeParse({ ...stateAt(15), furthestMiniLevel: 40 }).success,
    ).toBe(true);
  });
});

describe("moving on because the learner asked", () => {
  it("moves exactly one level", () => {
    const moved = advanceOnRequest(stateAt(3));

    expect(moved?.to).toBe(4);
    expect(moved?.level.miniLevel).toBe(4);
  });

  it("records the level left behind as skipped, not mastered", () => {
    const moved = advanceOnRequest(stateAt(3));

    expect(moved?.state.skippedMiniLevels).toEqual([3]);
    expect(wasSkipped(moved!.state, 3)).toBe(true);
    expect(wasSkipped(moved!.state, 4)).toBe(false);
  });

  it("does not record the same level twice", () => {
    // A learner can come back to a level they walked past and walk past it
    // again. The record is a set of levels, not a tally of decisions.
    const revisited = stateAt(3, { furthestMiniLevel: 9, skippedMiniLevels: [3] });

    expect(advanceOnRequest(revisited)?.state.skippedMiniLevels).toEqual([3]);
  });

  it("keeps levels skipped earlier when another is added", () => {
    const state = stateAt(7, { furthestMiniLevel: 9, skippedMiniLevels: [3, 5] });

    expect(advanceOnRequest(state)?.state.skippedMiniLevels).toEqual([3, 5, 7]);
  });

  it("carries the learner across a band boundary, level and all", () => {
    const moved = advanceOnRequest(stateAt(15));

    expect(moved?.to).toBe(16);
    expect(moved?.state.effectiveLevel.cefr).toBe("A2");
    expect(() => learnerStateSchema.parse(moved?.state)).not.toThrow();
  });

  it("stops at the end of the path rather than promising a B2", () => {
    expect(advanceOnRequest(stateAt(MAX_MINI_LEVEL))).toBeNull();
  });

  it("moves the furthest point along with the learner", () => {
    const moved = advanceOnRequest(stateAt(3));

    expect(moved?.state.furthestMiniLevel).toBe(4);
  });
});

describe("what one turn counts as", () => {
  it("counts a turn with no errors as strong", () => {
    expect(isStrongTurn({ errors: [] })).toBe(true);
  });

  it("counts any error at all as a weak turn", () => {
    // The gate is arithmetic over facts. "Nothing to correct" is a fact; how
    // bad the error was is an opinion, and opinions do not gate levels.
    expect(isStrongTurn({ errors: [{}] })).toBe(false);
    expect(isStrongTurn({ errors: [{}, {}, {}] })).toBe(false);
  });
});

describe("when a tally counts as mastery", () => {
  it("opens at six strong turns in seven", () => {
    expect(hasMastered({ turns: 7, strongTurns: 6 })).toBe(true);
  });

  it("stays closed one strong turn short", () => {
    expect(hasMastered({ turns: 7, strongTurns: 5 })).toBe(false);
  });

  it("waits for the minimum evidence, however flawless", () => {
    // A perfect run one turn short is a mood; seven evaluated turns are evidence.
    expect(
      hasMastered({ turns: MASTERY_MIN_TURNS - 1, strongTurns: MASTERY_MIN_TURNS - 1 }),
    ).toBe(false);
  });

  it("opens for a longer tally that has settled at the bar", () => {
    // Early mistakes wash out: sixteen strong of twenty is still four in five.
    expect(hasMastered({ turns: 20, strongTurns: 16 })).toBe(true);
    expect(hasMastered({ turns: 20, strongTurns: 15 })).toBe(false);
  });

  it("never opens for an empty tally", () => {
    expect(hasMastered({ turns: 0, strongTurns: 0 })).toBe(false);
  });

  it("keeps the bar where the product promises it", () => {
    // Absolute, not relative: a drifted constant passes every test that is
    // written in terms of itself.
    expect(MASTERY_RATIO).toBe(0.8);
    expect(MASTERY_MIN_TURNS).toBe(7);
  });
});

describe("moving on because the learner earned it", () => {
  it("moves them exactly one level", () => {
    const moved = advanceOnMastery(stateAt(26));

    expect(moved?.from).toBe(26);
    expect(moved?.to).toBe(27);
    expect(moved?.state.miniLevel).toBe(27);
  });

  it("does not record the mastered level as skipped", () => {
    const moved = advanceOnMastery(stateAt(26));

    expect(moved?.state.skippedMiniLevels).not.toContain(26);
  });

  it("un-skips a level they once walked past and have now beaten", () => {
    // The skip list is a record of levels moved past without mastering. A
    // learner who came back and earned it has erased that fact.
    const moved = advanceOnMastery(stateAt(26, { skippedMiniLevels: [12, 26] }));

    expect(moved?.state.skippedMiniLevels).toEqual([12]);
  });

  it("raises the high-water mark with them", () => {
    const moved = advanceOnMastery(stateAt(26, { furthestMiniLevel: 30 }));

    expect(moved?.state.furthestMiniLevel).toBe(30);
    expect(advanceOnMastery(stateAt(26))?.state.furthestMiniLevel).toBe(27);
  });

  it("crosses a band boundary with the whole state agreeing", () => {
    const moved = advanceOnMastery(stateAt(15));

    expect(moved?.state.effectiveLevel.cefr).toBe("A2");
    expect(learnerStateSchema.safeParse(moved?.state).success).toBe(true);
  });

  it("returns null at the end of the path", () => {
    expect(advanceOnMastery(stateAt(MAX_MINI_LEVEL))).toBeNull();
  });
});

describe("reading a request to move on", () => {
  it.each([
    "weiter",
    "Weiter bitte",
    "next",
    "Next please",
    "nächstes",
    "I want to move to next",
    "i want to move on",
    "can we move on",
    "let's move on",
    "Move me to the next level",
    "next lesson",
    "skip this",
    "zum nächsten Thema",
    "nächstes Level",
    "weitermachen",
    "überspringen",
    "I'm done with this",
    "ich bin fertig",
    "das kann ich schon",
    "ready for the next",
  ])("reads %j as a request to move on", (message) => {
    expect(asksToAdvance(message)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "Hallo! Wie geht es dir?",
    "Was heißt weitermachen auf Englisch?",
    "Das nächste Wort ist schwer",
    "Ich möchte einen Kaffee",
    "My next holiday is in Berlin",
    "Wir sind nächste Woche in Wien",
    "Ich bin fertig mit meinem Kaffee",
    "Was bedeutet überspringen?",
    "How do you say next in German?",
    "Das Buch ist weiter hinten",
  ])("leaves %j as an ordinary sentence", (message) => {
    // Moving somebody who did not ask is worse than not moving somebody who
    // did: they lose their place in a syllabus they were working through.
    expect(asksToAdvance(message)).toBe(false);
  });
});
