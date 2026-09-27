import { describe, expect, it } from "vitest";

import { CEFR_LEVELS, type CEFRLevel } from "../src/cefr";
import { PLAN_CODES } from "../src/plans";
import {
  CHAT_TIER_LADDER,
  PLAN_INVARIANT_TASKS,
  PLAN_ROUTED_TASKS,
  TASK_IDS,
  ceilingsFor,
  maxCeilingsFor,
  routeFor,
  tierFor,
  type TaskId,
  type Tier,
} from "../src/tasks";

/**
 * Plan-dependent routing, held to billing-and-plans-spec.md S3 and S4.
 *
 * A plan buys a better tutor, never a different grade. Every rule the spec
 * states about byPlan is asserted here against the whole table rather than
 * against the three rows that happen to carry an entry today, so the fourth
 * one is checked the moment it is written.
 */

const LEVELS_AND_NONE: readonly (CEFRLevel | undefined)[] = [...CEFR_LEVELS, undefined];

const rung = (tier: Tier): number => (CHAT_TIER_LADDER as readonly Tier[]).indexOf(tier);

describe("the chat tier ladder", () => {
  it("runs strongest first, and holds only the tiers that carry chat", () => {
    expect(CHAT_TIER_LADDER).toEqual(["reasoning", "strong", "mid", "cheap", "nano"]);
  });
});

describe("which tasks a plan may change", () => {
  it("is exactly the tutor, its repair and the Trainer's loop", () => {
    expect([...PLAN_ROUTED_TASKS].sort()).toEqual([
      "conversation.repair",
      "conversation.turn",
      "trainer.session",
    ]);
  });

  it("names every task that grades German or writes learner state as plan-invariant", () => {
    const assessments = TASK_IDS.filter((task) => task.startsWith("assessment."));

    expect([...PLAN_INVARIANT_TASKS].sort()).toEqual(
      [
        "evaluation.learner_message",
        "extraction.errors",
        "extraction.vocabulary_usage",
        "trainer.answer_analysis",
        "trainer.session_mining",
        "classification.safety_screen",
        ...assessments,
      ].sort(),
    );
    expect(assessments.length).toBeGreaterThan(0);
  });

  it("never lets a plan-invariant task acquire a plan entry", () => {
    // A cheaper evaluator for free learners would make a level mean less on
    // Free. The overlap between the two lists must stay empty.
    for (const task of PLAN_INVARIANT_TASKS) {
      expect(PLAN_ROUTED_TASKS, task).not.toContain(task);
      expect(routeFor(task).byPlan, task).toBeUndefined();
    }
  });

  it.each(PLAN_INVARIANT_TASKS)("routes %s identically on every plan", (task) => {
    for (const plan of PLAN_CODES) {
      expect(tierFor(task, plan), plan).toBe(tierFor(task));
      for (const level of LEVELS_AND_NONE) {
        expect(ceilingsFor(task, level, plan), `${plan} ${level}`).toEqual(ceilingsFor(task, level));
      }
    }
  });
});

describe("what a plan entry may do", () => {
  const entries = TASK_IDS.flatMap((task) =>
    PLAN_CODES.filter((plan) => routeFor(task).byPlan?.[plan] !== undefined).map(
      (plan) => [task, plan] as const,
    ),
  );

  it("exists at all", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("moves %s on %s only down the chat ladder, never up", (task, plan) => {
    const row = routeFor(task).tier;
    const planned = tierFor(task, plan);

    // Both on the ladder: a plan cannot move an embedding onto a chat model.
    expect(rung(row), `${task} row`).toBeGreaterThanOrEqual(0);
    expect(rung(planned), `${task} ${plan}`).toBeGreaterThanOrEqual(0);
    expect(rung(planned), `${task} ${plan}`).toBeGreaterThanOrEqual(rung(row));
  });

  it.each(entries)("keeps %s on %s inside the row's ceilings at every level", (task, plan) => {
    const row = maxCeilingsFor(task);

    for (const level of LEVELS_AND_NONE) {
      const ceilings = ceilingsFor(task, level, plan);
      expect(ceilings.maxInputTokens, `${level} input`).toBeLessThanOrEqual(row.maxInputTokens);
      expect(ceilings.maxOutputTokens, `${level} output`).toBeLessThanOrEqual(row.maxOutputTokens);
      expect(ceilings.maxInputTokens, `${level} input`).toBeGreaterThan(0);
      expect(ceilings.maxOutputTokens, `${level} output`).toBeGreaterThan(0);
    }
  });

  it("keeps every task's row as the maximum any plan reaches at any level", () => {
    for (const task of TASK_IDS) {
      const row = maxCeilingsFor(task);
      for (const plan of [...PLAN_CODES, undefined]) {
        for (const level of LEVELS_AND_NONE) {
          const ceilings = ceilingsFor(task, level, plan);
          expect(ceilings.maxInputTokens, `${task} ${plan} ${level}`).toBeLessThanOrEqual(row.maxInputTokens);
          expect(ceilings.maxOutputTokens, `${task} ${plan} ${level}`).toBeLessThanOrEqual(row.maxOutputTokens);
        }
      }
    }
  });
});

describe("resolution with no plan", () => {
  /**
   * What every task resolved to before byPlan existed. The spec's rule is
   * that a call with no plan resolves exactly as it did, so this is the
   * pre-plan table, transcribed rather than derived.
   */
  const BEFORE: Partial<Record<TaskId, { tier: Tier; byLevel: Record<CEFRLevel, [number, number]>; none: [number, number] }>> = {
    "conversation.turn": {
      tier: "strong",
      byLevel: { A1: [4000, 300], A2: [5000, 450], B1: [6000, 700] },
      none: [6000, 700],
    },
    "conversation.repair": {
      tier: "strong",
      byLevel: { A1: [6000, 700], A2: [6000, 700], B1: [6000, 700] },
      none: [6000, 700],
    },
    "trainer.session": {
      tier: "strong",
      byLevel: { A1: [6000, 1000], A2: [6000, 1000], B1: [6000, 1000] },
      none: [6000, 1000],
    },
  };

  it.each(Object.keys(BEFORE) as TaskId[])("resolves %s as it did before plans", (task) => {
    const before = BEFORE[task]!;
    const pair = (level?: CEFRLevel) => {
      const { maxInputTokens, maxOutputTokens } = ceilingsFor(task, level);
      return [maxInputTokens, maxOutputTokens];
    };

    expect(tierFor(task)).toBe(before.tier);
    for (const level of CEFR_LEVELS) expect(pair(level), level).toEqual(before.byLevel[level]);
    expect(pair(), "no level").toEqual(before.none);
  });

  it("is the row's own tier for every task", () => {
    for (const task of TASK_IDS) expect(tierFor(task), task).toBe(routeFor(task).tier);
  });
});

describe("resolution on a plan", () => {
  it("runs the free tutor, its repair and its Trainer on mid", () => {
    expect(tierFor("conversation.turn", "free")).toBe("mid");
    expect(tierFor("conversation.repair", "free")).toBe("mid");
    expect(tierFor("trainer.session", "free")).toBe("mid");
  });

  it("keeps plus and premium on the row's tier", () => {
    for (const plan of ["plus", "premium"] as const) {
      expect(tierFor("conversation.turn", plan)).toBe("strong");
      expect(tierFor("trainer.session", plan)).toBe("strong");
    }
  });

  it("gives free and plus the level table's ceilings", () => {
    for (const plan of ["free", "plus"] as const) {
      expect(ceilingsFor("conversation.turn", "A1", plan)).toEqual({ maxInputTokens: 4000, maxOutputTokens: 300 });
      expect(ceilingsFor("conversation.turn", "A2", plan)).toEqual({ maxInputTokens: 5000, maxOutputTokens: 450 });
      expect(ceilingsFor("conversation.turn", "B1", plan)).toEqual({ maxInputTokens: 6000, maxOutputTokens: 700 });
    }
  });

  it("widens premium's context at every level", () => {
    expect(ceilingsFor("conversation.turn", "A1", "premium")).toEqual({ maxInputTokens: 5000, maxOutputTokens: 400 });
    expect(ceilingsFor("conversation.turn", "A2", "premium")).toEqual({ maxInputTokens: 6500, maxOutputTokens: 600 });
    expect(ceilingsFor("conversation.turn", "B1", "premium")).toEqual({ maxInputTokens: 8000, maxOutputTokens: 1000 });
  });

  it("gives a call with no level the largest its plan reaches at any level", () => {
    // Not the row: the row is premium's maximum, and a free or plus call that
    // forgot its level must not be handed premium's context.
    expect(ceilingsFor("conversation.turn", undefined, "free")).toEqual({ maxInputTokens: 6000, maxOutputTokens: 700 });
    expect(ceilingsFor("conversation.turn", undefined, "premium")).toEqual({ maxInputTokens: 8000, maxOutputTokens: 1000 });
  });

  it("makes premium's widest level the row itself", () => {
    expect(maxCeilingsFor("conversation.turn")).toEqual({ maxInputTokens: 8000, maxOutputTokens: 1000 });
  });

  it("uses the row for a plan-routed task whose ceilings do not vary", () => {
    for (const plan of PLAN_CODES) {
      for (const level of LEVELS_AND_NONE) {
        expect(ceilingsFor("trainer.session", level, plan)).toEqual({ maxInputTokens: 6000, maxOutputTokens: 1000 });
        expect(ceilingsFor("conversation.repair", level, plan)).toEqual({ maxInputTokens: 6000, maxOutputTokens: 700 });
      }
    }
  });
});
