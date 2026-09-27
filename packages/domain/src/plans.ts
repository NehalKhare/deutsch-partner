import { z } from "zod";

/**
 * The plan catalogue.
 *
 * billing-and-plans-spec.md S2, transcribed. A plan buys convenience, depth
 * and volume: how much a learner may do in a day, how much knowledge a turn
 * is given, and which model-backed features exist for them. It never buys a
 * level or a verdict, which is why nothing here touches evaluation, mastery or
 * progression, and why the tier a plan runs on is not in this file at all: it
 * is a byPlan entry in the routing table (tasks.ts), where document 4's rules
 * about tiers already apply.
 *
 * Prices are deliberately absent. Stripe holds them and billing_prices
 * mirrors them with a fetched_at stamp; a price in code is a figure that goes
 * quietly stale (spec S7). The one euro figure here is a spending bound, not
 * something a learner pays.
 */

export const PLAN_CODES = ["free", "plus", "premium"] as const;

export const planCodeSchema = z.enum(PLAN_CODES);
export type PlanCode = z.infer<typeof planCodeSchema>;

/** The plans that can be bought. Free is what a learner has when they bought nothing. */
export const PAID_PLAN_CODES = ["plus", "premium"] as const satisfies readonly PlanCode[];

export const paidPlanCodeSchema = z.enum(PAID_PLAN_CODES);
export type PaidPlanCode = z.infer<typeof paidPlanCodeSchema>;

/**
 * What a daily quota counts. One learner action each: a tutor turn, a Trainer
 * request, a transcription, a line read aloud by a model voice. The device's
 * own speech synthesis is not here because it costs nothing and is never
 * counted, on any plan.
 */
export const QUOTA_KINDS = [
  "tutor_turns",
  "trainer_requests",
  "transcriptions",
  "voice_lines",
] as const;

export const quotaKindSchema = z.enum(QUOTA_KINDS);
export type QuotaKind = z.infer<typeof quotaKindSchema>;

/**
 * A fixed window that opens on first use and closes 24 hours later, counted by
 * the same Postgres mechanism as the per-minute rate limits. Not a calendar
 * day: a learner in Berlin and one in Mumbai get the same allowance.
 */
export const QUOTA_WINDOW_MS = 86_400_000;

export const PLAN_FEATURES = [
  "modelVoice",
  "handsFreeConversation",
  "trainerVoice",
  "milestoneReports",
  "longTermMemory",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

export interface PlanDefinition {
  readonly code: PlanCode;
  /** What a learner is shown. Free to change; the code is the identity. */
  readonly name: string;
  /** free 0, plus 1, premium 2. Entitlement picks the highest among current grants. */
  readonly rank: number;
  readonly dailyQuotas: Readonly<Record<QuotaKind, number>>;
  /** How many knowledge snippets a tutor turn is given. */
  readonly retrievalTopK: number;
  /**
   * The euro ceiling on one Trainer request: the loop, its analyzer and every
   * fallback it walks, together. A bound, not a charge. Free's is lower
   * because free's Trainer runs on the mid tier and needs less room, not to
   * cut a paying learner's session short.
   */
  readonly trainerTurnBoundEur: number;
  /**
   * Features that add model calls. Milestone reports and long-term memory are
   * not built yet; the entitlement is stated now so that building them is not
   * also a pricing decision.
   */
  readonly features: Readonly<Record<PlanFeature, boolean>>;
}

function plan(definition: PlanDefinition): PlanDefinition {
  return Object.freeze({
    ...definition,
    dailyQuotas: Object.freeze({ ...definition.dailyQuotas }),
    features: Object.freeze({ ...definition.features }),
  });
}

export const PLAN_CATALOGUE: Readonly<Record<PlanCode, PlanDefinition>> = Object.freeze({
  free: plan({
    code: "free",
    name: "Free",
    rank: 0,
    // Enough to reach A1 without paying, which is the point of free: word of
    // mouth from learners never asked for a card is the cheapest growth there is.
    dailyQuotas: { tutor_turns: 20, trainer_requests: 15, transcriptions: 5, voice_lines: 0 },
    retrievalTopK: 3,
    trainerTurnBoundEur: 0.02,
    features: {
      modelVoice: false,
      handsFreeConversation: false,
      trainerVoice: false,
      milestoneReports: false,
      longTermMemory: false,
    },
  }),
  plus: plan({
    code: "plus",
    name: "Plus",
    rank: 1,
    dailyQuotas: { tutor_turns: 150, trainer_requests: 100, transcriptions: 60, voice_lines: 150 },
    retrievalTopK: 5,
    trainerTurnBoundEur: 0.05,
    features: {
      modelVoice: true,
      handsFreeConversation: false,
      trainerVoice: false,
      milestoneReports: false,
      longTermMemory: false,
    },
  }),
  premium: plan({
    code: "premium",
    name: "Premium",
    rank: 2,
    dailyQuotas: { tutor_turns: 300, trainer_requests: 200, transcriptions: 200, voice_lines: 400 },
    retrievalTopK: 5,
    trainerTurnBoundEur: 0.05,
    features: {
      modelVoice: true,
      handsFreeConversation: true,
      trainerVoice: true,
      milestoneReports: true,
      longTermMemory: true,
    },
  }),
});

export function planDefinition(code: PlanCode): PlanDefinition {
  return PLAN_CATALOGUE[code];
}

/** For sorting: negative when `a` ranks below `b`. */
export function comparePlans(a: PlanCode, b: PlanCode): number {
  return PLAN_CATALOGUE[a].rank - PLAN_CATALOGUE[b].rank;
}

export function higherPlan(a: PlanCode, b: PlanCode): PlanCode {
  return comparePlans(a, b) >= 0 ? a : b;
}

export function isPaidPlan(code: PlanCode): code is PaidPlanCode {
  return (PAID_PLAN_CODES as readonly PlanCode[]).includes(code);
}
