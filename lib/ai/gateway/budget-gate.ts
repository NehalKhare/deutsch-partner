import { z } from "zod";

/**
 * Layer 4: the euro budget gate.
 *
 * Counters are maintained incrementally on ledger write and read here. Nothing
 * scans the ledger on a request path — a budget check whose cost grows with
 * the ledger is a budget check that gets removed the first time it is slow.
 *
 * The gate fails closed. An unreadable counter is not an empty one, and
 * treating it as zero spend is precisely how a broken budget becomes an
 * unlimited one.
 */

export const BUDGET_SCOPES = [
  "per_request",
  "per_user_daily",
  "per_user_monthly",
  "global_daily",
] as const;

export const budgetScopeSchema = z.enum(BUDGET_SCOPES);
export type BudgetScope = z.infer<typeof budgetScopeSchema>;

export interface BudgetSnapshot {
  readonly scope: BudgetScope;
  readonly scopeKey: string | null;
  readonly limitEur: number;
  readonly spentEur: number;
  readonly warnPct: number;
  readonly degradePct: number;
}

export interface BudgetSource {
  snapshot(input: {
    readonly userIdHash: string | null;
    readonly now: Date;
  }): Promise<readonly BudgetSnapshot[] | null>;
}

export type BudgetState = "allow" | "warn" | "degrade" | "deny";

export interface BudgetDecision {
  readonly state: BudgetState;
  readonly scope: BudgetScope | null;
  readonly ratio: number;
  readonly detail: string;
}

const RANK: Readonly<Record<BudgetState, number>> = {
  allow: 0,
  warn: 1,
  degrade: 2,
  deny: 3,
};

function stateFor(snapshot: BudgetSnapshot, projected: number): BudgetState {
  // A zero limit is a closed door, not an unlimited one.
  if (snapshot.limitEur <= 0) return "deny";

  const ratio = (snapshot.spentEur + projected) / snapshot.limitEur;

  if (ratio >= 1) return "deny";
  if (ratio >= snapshot.degradePct) return "degrade";
  if (ratio >= snapshot.warnPct) return "warn";
  return "allow";
}

/**
 * Evaluates every scope and returns the worst.
 *
 * `null` means the counters could not be read at all, which is a denial. An
 * empty list means no limits are configured, which is a deployment decision
 * and is allowed.
 */
export function evaluateBudgets(
  snapshots: readonly BudgetSnapshot[] | null,
  projectedEur = 0,
): BudgetDecision {
  if (snapshots === null) {
    return {
      state: "deny",
      scope: null,
      ratio: Number.POSITIVE_INFINITY,
      detail: "budget counters are unavailable; failing closed",
    };
  }

  let worst: BudgetDecision = {
    state: "allow",
    scope: null,
    ratio: 0,
    detail: "within budget",
  };

  for (const snapshot of snapshots) {
    const state = stateFor(snapshot, projectedEur);
    const ratio =
      snapshot.limitEur <= 0
        ? Number.POSITIVE_INFINITY
        : (snapshot.spentEur + projectedEur) / snapshot.limitEur;

    if (RANK[state] > RANK[worst.state]) {
      worst = {
        state,
        scope: snapshot.scope,
        ratio,
        detail: `${snapshot.scope} at ${(ratio * 100).toFixed(1)}% of ${snapshot.limitEur} EUR`,
      };
    }
  }

  return worst;
}

export interface CounterPeriod {
  readonly start: Date;
  readonly end: Date;
}

/**
 * The period a counter row covers.
 *
 * Daily is a UTC day and monthly is a calendar month. The routing document
 * describes the per-user daily scope as a rolling 24 hours; a rolling window
 * cannot be maintained by an incremental counter without scanning the ledger,
 * which is the thing the counters exist to avoid. A UTC day is the honest
 * approximation, and it is stated rather than implied.
 */
export function periodFor(scope: BudgetScope, now: Date): CounterPeriod {
  if (scope === "per_request") {
    // per_request is an accumulator on the request context. Persisting one row
    // per request would grow a table nothing ever reads.
    throw new Error("per_request is not a persisted counter scope");
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (scope === "per_user_monthly") {
    return {
      start: new Date(Date.UTC(year, month, 1)),
      end: new Date(Date.UTC(year, month + 1, 1)),
    };
  }

  const day = now.getUTCDate();

  return {
    start: new Date(Date.UTC(year, month, day)),
    end: new Date(Date.UTC(year, month, day + 1)),
  };
}

/** The scopes a ledger write increments. */
export const PERSISTED_SCOPES = [
  "per_user_daily",
  "per_user_monthly",
  "global_daily",
] as const satisfies readonly BudgetScope[];
