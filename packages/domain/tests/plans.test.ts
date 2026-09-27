import { describe, expect, it } from "vitest";

import {
  PAID_PLAN_CODES,
  PLAN_CATALOGUE,
  PLAN_CODES,
  PLAN_FEATURES,
  QUOTA_KINDS,
  QUOTA_WINDOW_MS,
  comparePlans,
  higherPlan,
  isPaidPlan,
  paidPlanCodeSchema,
  planCodeSchema,
  planDefinition,
  type PlanCode,
} from "../src/plans";

/**
 * The plan table, transcribed a second time.
 *
 * From billing-and-plans-spec.md S2 rather than imported from the module under
 * test: a test that reads the constant it is checking asserts nothing. A plan
 * that quietly gains ten tutor turns a day is a margin change, and it should
 * fail here before it shows up on the cost dashboard.
 */
const EXPECTED: Readonly<
  Record<
    PlanCode,
    {
      quotas: [number, number, number, number];
      topK: number;
      trainerBoundEur: number;
      features: [boolean, boolean, boolean, boolean, boolean];
    }
  >
> = {
  //                 tutor, trainer, transcriptions, voice lines
  free: { quotas: [20, 15, 5, 0], topK: 3, trainerBoundEur: 0.02, features: [false, false, false, false, false] },
  plus: { quotas: [150, 100, 60, 150], topK: 5, trainerBoundEur: 0.05, features: [true, false, false, false, false] },
  premium: { quotas: [300, 200, 200, 400], topK: 5, trainerBoundEur: 0.05, features: [true, true, true, true, true] },
};

describe("plan codes", () => {
  it("are a closed set of three", () => {
    expect(PLAN_CODES).toEqual(["free", "plus", "premium"]);
    expect(planCodeSchema.safeParse("platinum").success).toBe(false);
    expect(planCodeSchema.safeParse("Premium").success).toBe(false);
  });

  it("sells only the two that are not free", () => {
    expect(PAID_PLAN_CODES).toEqual(["plus", "premium"]);
    expect(paidPlanCodeSchema.safeParse("free").success).toBe(false);
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("plus")).toBe(true);
    expect(isPaidPlan("premium")).toBe(true);
  });
});

describe("the plan catalogue", () => {
  it.each(PLAN_CODES)("gives %s exactly the quotas the spec sets", (code) => {
    const plan = planDefinition(code);
    const [tutor, trainer, transcriptions, voice] = EXPECTED[code].quotas;

    expect(plan.code).toBe(code);
    expect(plan.dailyQuotas).toEqual({
      tutor_turns: tutor,
      trainer_requests: trainer,
      transcriptions,
      voice_lines: voice,
    });
  });

  it.each(PLAN_CODES)("gives %s its retrieval depth and Trainer bound", (code) => {
    expect(planDefinition(code).retrievalTopK).toBe(EXPECTED[code].topK);
    expect(planDefinition(code).trainerTurnBoundEur).toBe(EXPECTED[code].trainerBoundEur);
  });

  it.each(PLAN_CODES)("gives %s exactly the features the spec lists", (code) => {
    const [modelVoice, handsFree, trainerVoice, milestones, memory] = EXPECTED[code].features;

    expect(planDefinition(code).features).toEqual({
      modelVoice,
      handsFreeConversation: handsFree,
      trainerVoice,
      milestoneReports: milestones,
      longTermMemory: memory,
    });
  });

  it("keys every entry by its own code and names it for the learner", () => {
    for (const code of PLAN_CODES) {
      expect(PLAN_CATALOGUE[code].code).toBe(code);
      expect(PLAN_CATALOGUE[code].name).toMatch(/\S/);
    }
  });

  it("never lets a higher plan offer less than a lower one", () => {
    // Monotone in every dimension: an upgrade that loses something is a
    // support ticket, and a downgrade that gains something is a leak.
    const ordered = [...PLAN_CODES].sort(comparePlans);

    for (let i = 1; i < ordered.length; i += 1) {
      const lower = planDefinition(ordered[i - 1]!);
      const higher = planDefinition(ordered[i]!);

      expect(higher.rank).toBeGreaterThan(lower.rank);
      for (const kind of QUOTA_KINDS) {
        expect(higher.dailyQuotas[kind], `${higher.code} ${kind}`).toBeGreaterThanOrEqual(
          lower.dailyQuotas[kind],
        );
      }
      for (const feature of PLAN_FEATURES) {
        if (lower.features[feature]) expect(higher.features[feature], feature).toBe(true);
      }
      expect(higher.retrievalTopK).toBeGreaterThanOrEqual(lower.retrievalTopK);
      expect(higher.trainerTurnBoundEur).toBeGreaterThanOrEqual(lower.trainerTurnBoundEur);
    }
  });

  it("offers model voice exactly where it grants voice lines", () => {
    // The feature and the quota are one decision stated twice; they must not
    // disagree, or a learner is told they have voice and refused every line.
    for (const code of PLAN_CODES) {
      const plan = planDefinition(code);
      expect(plan.features.modelVoice, code).toBe(plan.dailyQuotas.voice_lines > 0);
    }
  });

  it("gives every plan a real tutor, so free is a product and not a demo", () => {
    for (const code of PLAN_CODES) {
      expect(planDefinition(code).dailyQuotas.tutor_turns, code).toBeGreaterThan(0);
      expect(planDefinition(code).dailyQuotas.trainer_requests, code).toBeGreaterThan(0);
    }
  });

  it("keeps the Trainer's bound at or under the ceiling the route was sized for", () => {
    // tasks.ts sizes trainer.session's tier against a 0.05 euro request. A plan
    // that raised it would be buying a tier the table never priced.
    for (const code of PLAN_CODES) {
      expect(planDefinition(code).trainerTurnBoundEur).toBeGreaterThan(0);
      expect(planDefinition(code).trainerTurnBoundEur).toBeLessThanOrEqual(0.05);
    }
  });

  it("is frozen, so no request can widen a plan for itself", () => {
    expect(Object.isFrozen(PLAN_CATALOGUE)).toBe(true);
    expect(Object.isFrozen(PLAN_CATALOGUE.free.dailyQuotas)).toBe(true);
    expect(Object.isFrozen(PLAN_CATALOGUE.free.features)).toBe(true);
  });

  it("counts the daily quotas over a fixed 24 hour window", () => {
    expect(QUOTA_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("ranking plans", () => {
  it("orders premium above plus above free", () => {
    expect([...PLAN_CODES].reverse().sort(comparePlans)).toEqual(["free", "plus", "premium"]);
    expect(comparePlans("premium", "plus")).toBeGreaterThan(0);
    expect(comparePlans("free", "plus")).toBeLessThan(0);
    expect(comparePlans("plus", "plus")).toBe(0);
  });

  it("picks the higher of two plans whichever order they arrive in", () => {
    expect(higherPlan("free", "premium")).toBe("premium");
    expect(higherPlan("premium", "plus")).toBe("premium");
    expect(higherPlan("plus", "free")).toBe("plus");
    expect(higherPlan("free", "free")).toBe("free");
  });
});
