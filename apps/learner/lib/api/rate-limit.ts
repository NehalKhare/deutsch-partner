import "server-only";

import {
  createMemoryRateLimiter,
  createPostgresRateLimiter,
  type RateLimitRule,
  type RateLimiter,
} from "@dp/db/rate-limit-repository";
import type { DatabaseClient } from "@dp/db/types";

import { actionLogger } from "@/lib/api/composition";
import { serverEnv } from "@/lib/env/server";
import { createSecretKeySupabaseClient } from "@/lib/supabase/server-client";

/**
 * Request-frequency limiting.
 *
 * A fixed window per learner per route, counted in Postgres so every instance
 * of this app shares one quota and a restart forgives nobody. The in-memory
 * counter it replaced was per instance: N instances allowed N times the quota.
 *
 * Note what this does *not* do. Rate limiting bounds how often; it does not
 * bound spend, because one request with a large context can cost more than a
 * thousand small ones. The euro budgets in the gateway are the other half, and
 * both are required.
 */

export type { RateLimitDecision, RateLimitRule, RateLimiter } from "@dp/db/rate-limit-repository";

/**
 * Quotas by who is asking, per guardrails S7.
 *
 * Chat is the expensive one and gets the tightest bound. Anonymous traffic
 * should not reach chat at all — the route requires a session — but the scope
 * exists so that adding an anonymous trial is a configuration change rather
 * than a new mechanism.
 */
export const RATE_LIMITS = {
  chat: { limit: 20, windowMs: 60_000 },
  chat_anonymous: { limit: 3, windowMs: 60_000 },
  // Tighter than chat, and for a reason chat does not have: voice calls are
  // not written to the ledger and not counted against the euro budgets, so
  // this is the only ceiling there is. Transcription is billed by the minute,
  // and ten minute-long clips a minute is already a bill worth noticing.
  transcribe: { limit: 10, windowMs: 60_000 },
  synthesize: { limit: 20, windowMs: 60_000 },
  // Scenario search embeds the query, so it is a model call with a bill —
  // small, cached across learners, but never unlimited (guardrails S7).
  search: { limit: 30, windowMs: 60_000 },
  // Half of chat's quota because one trainer request is not one model call:
  // the agent loop makes up to seven, plus whatever its tools fetch. The euro
  // budgets bound the spend; this bounds how fast a learner can reach them.
  trainer: { limit: 10, windowMs: 60_000 },
  // A vote on a reply: two small writes and no model call, so the bound is
  // about a held-down button rather than about cost. A learner cannot have
  // more replies to rate than the trainer limit above let them receive, so
  // this is generous and still finite.
  trainer_feedback: { limit: 30, windowMs: 60_000 },
  // The tightest quota in the product, and the only one that is not a
  // learner's. One press of "run a market scan" is a web-searching call per
  // query and then a reasoning-tier proposal, so a held-down button is the
  // most expensive thing anyone can do here. An operator has no reason to
  // exceed this and every reason not to (guardrails S7).
  product_ops: { limit: 5, windowMs: 60_000 },
  // Following a run: one open stream per run per operator, and the browser
  // reconnects on its own when one closes. A read of two small tables a
  // second, so the quota is about a misbehaving client and not about cost.
  product_ops_events: { limit: 30, windowMs: 60_000 },
  // Placing an order, starting the trial, opening the Customer Portal: each
  // is a call to Stripe with a customer behind it. Five a minute is more
  // than anyone paying needs and fewer than a script testing stolen cards
  // would like (billing-and-plans-spec.md S6).
  billing: { limit: 5, windowMs: 60_000 },
  // Trial starts, per day. What holds the trial to one is the order record
  // (billing_open_trial_checkout, under a per-learner lock): one trial
  // checkout open at a time, for the 35 minutes its session lives, and none
  // once one completed. This only bounds how many Stripe sessions a learner
  // who keeps abandoning Stripe's page can open in a day — three rather than
  // one, so abandoning it once is not a day-long lockout.
  billing_trial: { limit: 3, windowMs: 86_400_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

const limiters = new Map<RateLimitScope, RateLimiter>();

/**
 * Which backing a process gets.
 *
 * Postgres whenever there is a secret key to reach it with, which is every
 * deployment. The in-memory window is for a process that has none — a
 * laptop with no project linked, the unit tests — and production refuses it
 * outright rather than quietly running with a quota that is per instance.
 *
 * Exported for the daily plan quotas (lib/api/quota.ts), which are the same
 * mechanism over a longer window and must get exactly the same backing.
 */
export function createLimiter(scope: string, rule: RateLimitRule): RateLimiter {
  const env = serverEnv();
  if (env.SUPABASE_SECRET_KEY === undefined) {
    if (env.NODE_ENV === "production") {
      throw new Error("rate limiting needs the database in production");
    }
    return createMemoryRateLimiter(rule);
  }

  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;
  return createPostgresRateLimiter(client, scope, rule, {
    onUnavailable: (detail) => actionLogger().warn("rate_limit.unavailable", detail),
  });
}

/** The process-wide limiter for a scope, created on first use. */
export function limiterFor(scope: RateLimitScope): RateLimiter {
  const existing = limiters.get(scope);
  if (existing) return existing;

  const created = createLimiter(scope, RATE_LIMITS[scope]);
  limiters.set(scope, created);
  return created;
}

/** Test seam: forgets every limiter, so one test cannot exhaust another's quota. */
export function resetRateLimiters(): void {
  limiters.clear();
}
