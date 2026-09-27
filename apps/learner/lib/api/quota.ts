import "server-only";

import {
  PLAN_CATALOGUE,
  QUOTA_WINDOW_MS,
  type PlanCode,
  type QuotaKind,
} from "@dp/domain/plans";
import { MAX_AGENDA_ITEMS } from "@dp/domain/trainer-session";

import { createLimiter, type RateLimiter } from "@/lib/api/rate-limit";

/**
 * How much a learner may do in a day, by plan (billing-and-plans-spec.md S2).
 *
 * The per-minute limits bound how fast; these bound how much; the euro
 * budgets bound what it costs. All three are required, and this is the
 * middle one. It is the per-minute mechanism over a longer window — one
 * Postgres fixed window per learner, opened on first use and closed 24 hours
 * later, keyed by pseudonym — so it holds across instances and a restart
 * forgives nobody.
 *
 * One window per plan per kind. A learner who upgrades mid-window starts the
 * new plan's window from nothing, which is what paying should feel like; one
 * who is downgraded starts the smaller plan's, which the plan's own number
 * then bounds.
 *
 * The plan arrives resolved from entitlement rows on the server. Nothing here
 * reads one, and nothing a request carries can name one.
 */

/** Where a plan's window for one kind lives in rate_limit_buckets. */
export function quotaScope(plan: PlanCode, kind: QuotaKind): `quota_${QuotaKind}_${PlanCode}` {
  return `quota_${kind}_${plan}`;
}

export type QuotaDecision =
  | { readonly allowed: true; readonly remaining: number; readonly resetAt: Date }
  /** The plan does not include this at all. No window was opened, so there is nothing to wait for. */
  | { readonly allowed: false; readonly refusal: "plan_required"; readonly resetAt: null }
  | { readonly allowed: false; readonly refusal: "quota_exhausted"; readonly resetAt: Date }
  /**
   * The store could not count. Refused, because nobody can be said to be
   * within their day — but an outage, not the learner's quota: nothing was
   * used, there is no window to wait out, and no plan would change it.
   */
  | { readonly allowed: false; readonly refusal: "unavailable"; readonly resetAt: null };

const UNAVAILABLE: QuotaDecision = { allowed: false, refusal: "unavailable", resetAt: null };

const limiters = new Map<string, RateLimiter>();

/** The process-wide window for a plan and kind, created on first use. */
export function quotaLimiterFor(plan: PlanCode, kind: QuotaKind): RateLimiter {
  const scope = quotaScope(plan, kind);
  const existing = limiters.get(scope);
  if (existing) return existing;

  const created = createLimiter(scope, {
    limit: PLAN_CATALOGUE[plan].dailyQuotas[kind],
    windowMs: QUOTA_WINDOW_MS,
  });
  limiters.set(scope, created);
  return created;
}

/**
 * Counts one use against the learner's plan, or says why it may not happen.
 *
 * A quota of zero is a feature the plan does not include, and is refused
 * before anything is counted: the store refuses a limit below one, and a
 * learner asking for something their plan lacks has not used anything up.
 */
export async function consumeQuota(
  plan: PlanCode,
  kind: QuotaKind,
  userIdHash: string,
): Promise<QuotaDecision> {
  if (PLAN_CATALOGUE[plan].dailyQuotas[kind] <= 0) {
    return { allowed: false, refusal: "plan_required", resetAt: null };
  }

  const decision = await quotaLimiterFor(plan, kind).check(userIdHash);
  if (decision.allowed) return { allowed: true, remaining: decision.remaining, resetAt: decision.resetAt };
  if (decision.unavailable) return UNAVAILABLE;
  return { allowed: false, refusal: "quota_exhausted", resetAt: decision.resetAt };
}

/**
 * Requests a Trainer session already under way may take past the day's
 * quota: twice the longest agenda a session can pin, which is more than any
 * honest session needs to finish.
 */
export const TRAINER_AGENDA_OVERDRAFT = 2 * MAX_AGENDA_ITEMS;

/** Where a plan's agenda overdraft lives in rate_limit_buckets. */
export function agendaOverdraftScope(plan: PlanCode): `quota_trainer_agenda_${PlanCode}` {
  return `quota_trainer_agenda_${plan}`;
}

const overdrafts = new Map<PlanCode, RateLimiter>();

function overdraftFor(plan: PlanCode): RateLimiter {
  const existing = overdrafts.get(plan);
  if (existing) return existing;
  const created = createLimiter(agendaOverdraftScope(plan), {
    limit: TRAINER_AGENDA_OVERDRAFT,
    windowMs: QUOTA_WINDOW_MS,
  });
  overdrafts.set(plan, created);
  return created;
}

/**
 * One Trainer request against the plan's day, without cutting a session off
 * midway (spec S4: "a quota never interrupts a Trainer agenda midway").
 *
 * Every request is counted, so the day's number means what the catalogue
 * says. When it is spent, a request that opens a session is refused — the
 * prompt appears before a session, never inside one — and a request that
 * continues one is let through from a small daily overdraft instead.
 *
 * Whether a request continues a session is the browser's claim (it carries
 * the pinned agenda and what is covered), so the overdraft is bounded: a
 * client that always claims to be mid-session gets TRAINER_AGENDA_OVERDRAFT
 * more requests a day and no further, each still inside the per-minute limit,
 * the per-request euro bound and the monthly allowance.
 */
export async function consumeTrainerQuota(
  plan: PlanCode,
  userIdHash: string,
  session: { readonly continuing: boolean },
): Promise<QuotaDecision> {
  const decision = await consumeQuota(plan, "trainer_requests", userIdHash);
  if (decision.allowed || decision.refusal !== "quota_exhausted" || !session.continuing) return decision;

  const overdraft = await overdraftFor(plan).check(userIdHash);
  if (overdraft.allowed) return { allowed: true, remaining: 0, resetAt: decision.resetAt };
  return overdraft.unavailable ? UNAVAILABLE : decision;
}

/** Test seam: forgets every window, so one test cannot spend another's day. */
export function resetQuotaLimiters(): void {
  limiters.clear();
  overdrafts.clear();
}
