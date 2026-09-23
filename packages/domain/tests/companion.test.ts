import { describe, expect, it } from "vitest";
import {
  COMPANION_EMOTIONS,
  companionActivityFor,
  companionEmotionSchema,
  companionStateFor,
  companionStateSchema,
  growthProgress,
  growthStageForMiniLevel,
  MAX_GROWTH_STAGE,
} from "../src/companion";

/**
 * The companion is a learner-facing progress signal, so its state is domain
 * data derived from learner progress — not view state owned by a component.
 */

describe("companionEmotionSchema", () => {
  it("has exactly the three designed emotions", () => {
    expect(COMPANION_EMOTIONS).toEqual(["smiling", "sad", "listening"]);
  });

  it.each(COMPANION_EMOTIONS)("accepts %s", (emotion) => {
    expect(companionEmotionSchema.parse(emotion)).toBe(emotion);
  });

  it.each(["happy", "angry", "SMILING", ""])("rejects %o", (value) => {
    expect(companionEmotionSchema.safeParse(value).success).toBe(false);
  });
});

describe("growthStageForMiniLevel", () => {
  it("starts at the smallest stage", () => {
    expect(growthStageForMiniLevel(1)).toBe(1);
  });

  it("is fully grown by the end of the path", () => {
    expect(growthStageForMiniLevel(70)).toBe(MAX_GROWTH_STAGE);
  });

  it("is still growing when the learner reaches B1", () => {
    // The final form is the reward for the last stretch, not for arriving at
    // B1 — there are 35 mini-levels of B1 still to go at that point.
    expect(growthStageForMiniLevel(36)).toBeLessThan(MAX_GROWTH_STAGE);
  });

  it("passes through every stage across the path", () => {
    const stages = new Set(
      Array.from({ length: 70 }, (_, i) => growthStageForMiniLevel(i + 1)),
    );

    expect(stages.size).toBe(MAX_GROWTH_STAGE);
  });

  it("divides the path into equal bands, so growth never stalls", () => {
    const counts = new Map<number, number>();
    for (let miniLevel = 1; miniLevel <= 70; miniLevel += 1) {
      const stage = growthStageForMiniLevel(miniLevel);
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }

    expect([...counts.values()]).toEqual([14, 14, 14, 14, 14]);
  });

  it("never shrinks as the learner progresses", () => {
    let previous = 0;
    for (let miniLevel = 1; miniLevel <= 70; miniLevel += 1) {
      const stage = growthStageForMiniLevel(miniLevel);
      expect(stage).toBeGreaterThanOrEqual(previous);
      previous = stage;
    }
  });

  it("rejects a mini-level outside the curriculum", () => {
    expect(() => growthStageForMiniLevel(0)).toThrow();
  });
});

describe("growthProgress", () => {
  it("is zero at the first mini-level and one at the last", () => {
    expect(growthProgress(1)).toBe(0);
    expect(growthProgress(70)).toBe(1);
  });

  it("increases monotonically", () => {
    expect(growthProgress(35)).toBeGreaterThan(growthProgress(20));
  });

  it("stays within the unit interval", () => {
    for (let miniLevel = 1; miniLevel <= 70; miniLevel += 1) {
      const progress = growthProgress(miniLevel);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("companionStateFor", () => {
  it("listens while the learner is speaking", () => {
    const state = companionStateFor({ miniLevel: 10, activity: "listening" });

    expect(state.emotion).toBe("listening");
    expect(state.animated).toBe(false);
  });

  it("smiles and animates while the companion is speaking", () => {
    const state = companionStateFor({ miniLevel: 10, activity: "speaking" });

    expect(state).toMatchObject({ emotion: "smiling", animated: true });
  });

  it("looks sad when the learner is struggling", () => {
    const state = companionStateFor({ miniLevel: 10, activity: "struggling" });

    expect(state).toMatchObject({ emotion: "sad", animated: false });
  });

  it("smiles at rest", () => {
    expect(companionStateFor({ miniLevel: 1, activity: "idle" }).emotion).toBe(
      "smiling",
    );
  });

  it("carries the activity through, so the drawing knows which performance to run", () => {
    // Idle has its own ambient loops — glances, a quirked smile — and the
    // stylesheet can only key them off the state if the state says idle.
    for (const activity of ["idle", "listening", "speaking", "struggling"] as const) {
      expect(companionStateFor({ miniLevel: 10, activity }).activity).toBe(activity);
    }
  });

  it("carries the growth derived from the learner's mini-level", () => {
    const early = companionStateFor({ miniLevel: 1, activity: "idle" });
    const late = companionStateFor({ miniLevel: 70, activity: "idle" });

    expect(late.stage).toBeGreaterThan(early.stage);
    expect(late.progress).toBeGreaterThan(early.progress);
  });

  it("produces a state that satisfies its own schema", () => {
    const state = companionStateFor({ miniLevel: 42, activity: "speaking" });

    expect(companionStateSchema.parse(state)).toEqual(state);
  });

  it("rejects an unknown activity", () => {
    expect(() =>
      // @ts-expect-error deliberately invalid activity
      companionStateFor({ miniLevel: 1, activity: "dancing" }),
    ).toThrow();
  });
});

/**
 * What the companion is doing, derived from what is happening in the turn.
 *
 * A pure function rather than a ternary in the component, for two reasons: it
 * is the only place the precedence between "the tutor is replying" and "the
 * learner is typing" is decided, and it is the seam voice plugs into — spoken
 * output will set `replying` from audio playback rather than from arriving
 * text, and nothing else has to change.
 */
describe("companionActivityFor", () => {
  const nothing = { replying: false, sending: false, composing: false };

  it("is idle when nothing is happening", () => {
    expect(companionActivityFor(nothing)).toBe("idle");
  });

  it("speaks while the tutor's reply is arriving", () => {
    expect(companionActivityFor({ ...nothing, replying: true })).toBe("speaking");
  });

  it("listens while the learner is typing", () => {
    expect(companionActivityFor({ ...nothing, composing: true })).toBe("listening");
  });

  it("listens while the learner's message is in flight", () => {
    // It has been given something and has not answered yet. Taking it in is
    // listening; a blank stare is what a spinner already does badly.
    expect(companionActivityFor({ ...nothing, sending: true })).toBe("listening");
  });

  it("speaks over everything else once words are arriving", () => {
    // A learner who starts typing their next line mid-reply must not stop the
    // companion mid-sentence.
    expect(
      companionActivityFor({ replying: true, sending: true, composing: true }),
    ).toBe("speaking");
  });

  it("hands the component a state that animates only while speaking", () => {
    // The end-to-end property the product asks for, asserted through the same
    // path the component uses rather than on the mapping alone.
    const state = (situation: Parameters<typeof companionActivityFor>[0]) =>
      companionStateFor({
        miniLevel: 1,
        activity: companionActivityFor(situation),
      });

    expect(state({ ...nothing, replying: true }).animated).toBe(true);
    expect(state({ ...nothing, composing: true }).animated).toBe(false);
    expect(state({ ...nothing, composing: true }).emotion).toBe("listening");
    expect(state({ ...nothing, sending: true }).emotion).toBe("listening");
    expect(state(nothing).emotion).toBe("smiling");
  });
});
