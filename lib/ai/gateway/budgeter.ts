import { gatewayFail, gatewayOk, type GatewayResult } from "@/lib/ai/gateway/errors";
import type { TaskId } from "@/lib/ai/tasks";

/**
 * Layer 1 of the ceiling enforcement, plus the per-turn accumulator.
 *
 * The deterministic shedding the routing document describes lives in the
 * prompt builder, which is where the blocks are: by the time a prompt reaches
 * here it has already been trimmed as far as it can be. What remains is the
 * final refusal — a prompt still over its ceiling is rejected rather than sent,
 * because a provider asked to take an oversized prompt truncates it somewhere
 * of its own choosing, and that place is usually the current message.
 */

export function preflight(
  spec: { readonly maxInputTokens: number },
  promptTokens: number,
): GatewayResult<{ readonly promptTokens: number }> {
  if (promptTokens > spec.maxInputTokens) {
    return gatewayFail(
      "ceiling_denied",
      `${promptTokens} input tokens exceeds the ${spec.maxInputTokens} ceiling for this call`,
    );
  }

  return gatewayOk({ promptTokens });
}

/**
 * The calls a learner turn can lose without losing the turn.
 *
 * Memory extraction is batched and can run later. A tiebreak only refines an
 * ordering the deterministic scorer already produced. A query rewrite is off
 * by default and is an optimisation by definition. Everything else — the
 * reply, the evaluation that drives progression, the error extraction that
 * feeds review — changes what the learner gets.
 */
export const OPTIONAL_TASKS: ReadonlySet<TaskId> = new Set<TaskId>([
  "extraction.memory",
  "recommendation.tiebreak",
  "retrieval.query_rewrite",
]);

export interface PlannedCall {
  readonly task: TaskId;
  readonly estimatedTokens: number;
}

export interface TurnPlan {
  readonly admitted: readonly PlannedCall[];
  readonly dropped: readonly PlannedCall[];
  /**
   * Required calls that still do not fit. They stay admitted: dropping one
   * would silently break a feature. Naming them here is what makes the
   * overrun visible instead.
   */
  readonly overBudget: readonly PlannedCall[];
}

/**
 * Decides which of a turn's calls fit inside its aggregate token budget.
 *
 * Optional calls go first, most expensive first, because dropping the biggest
 * one may be enough where dropping three small ones is not.
 */
export function planTurn(
  calls: readonly PlannedCall[],
  maxTurnTokens: number,
): TurnPlan {
  const total = (list: readonly PlannedCall[]) =>
    list.reduce((sum, call) => sum + call.estimatedTokens, 0);

  const dropped: PlannedCall[] = [];
  let admitted = [...calls];

  while (total(admitted) > maxTurnTokens) {
    const optional = admitted.filter((call) => OPTIONAL_TASKS.has(call.task));
    if (optional.length === 0) break;

    const worst = optional.reduce((a, b) =>
      b.estimatedTokens > a.estimatedTokens ? b : a,
    );
    admitted = admitted.filter((call) => call !== worst);
    dropped.push(worst);
  }

  return {
    admitted,
    // Reported in the caller's order, not in the order they were dropped: the
    // caller reads this to decide what to skip, not to replay the search.
    dropped: calls.filter((call) => dropped.includes(call)),
    overBudget: total(admitted) > maxTurnTokens ? admitted : [],
  };
}

/**
 * The per-request euro ceiling.
 *
 * An accumulator on the request context rather than a counter row: a per
 * request scope would write one row per request into a table nothing reads,
 * and the number is only meaningful for the length of the turn anyway.
 */
export interface TurnBudget {
  readonly maxEur: number;
  spentEur(): number;
  remainingEur(): number;
  wouldExceed(amountEur: number): boolean;
  record(amountEur: number): void;
}

export function createTurnBudget(maxEur: number): TurnBudget {
  let spent = 0;

  return {
    maxEur,
    spentEur: () => spent,
    remainingEur: () => Math.max(0, maxEur - spent),
    wouldExceed: (amountEur) => spent + amountEur > maxEur,
    record: (amountEur) => {
      spent += amountEur;
    },
  };
}
