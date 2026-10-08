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
 * A fixed window per operator per route, counted in Postgres so every instance
 * of this app shares one quota and a restart forgives nobody. The in-memory
 * counter it replaced was per instance: N instances allowed N times the quota.
 *
 * Note what this does *not* do. Rate limiting bounds how often; it does not
 * bound spend, because one request with a large context can cost more than a
 * thousand small ones. The euro budgets in the gateway are the other half, and
 * both are required.
 */

export type { RateLimitDecision, RateLimitRule, RateLimiter } from "@dp/db/rate-limit-repository";

/** Quotas by who is asking, per guardrails S7. */
export const RATE_LIMITS = {
  // The tightest quota in the product. One press of "run a market scan" is a
  // web-searching call per query and then a reasoning-tier proposal, so a
  // held-down button is the most expensive thing anyone can do here. An
  // operator has no reason to exceed this and every reason not to.
  product_ops: { limit: 5, windowMs: 60_000 },
  // Following a run: one open stream per run per operator, and the browser
  // reconnects on its own when one closes.
  product_ops_events: { limit: 30, windowMs: 60_000 },
  // An operator changing what the product may spend, or asking the worker for
  // a fresh snapshot. Cheap for the database, but each one moves real money or
  // real jobs; a scripted loop should hit this long before it hits anything.
  ops_cost_admin: { limit: 20, windowMs: 60_000 },
  // Finding a learner by email or pseudonym. Each lookup is a scan and an
  // answer about whether an address has an account, so it is an enumeration
  // surface as much as a support tool.
  ops_learner_lookup: { limit: 20, windowMs: 60_000 },
  // Correcting, exporting or deleting one learner's data.
  ops_learner_write: { limit: 30, windowMs: 60_000 },
  // The bell: its poll, once a minute per open tab while visible, and the
  // marks an operator makes. Cheap reads of one small table, so the bound
  // is about a script and not about cost.
  ops_notifications: { limit: 30, windowMs: 60_000 },
  // Sign-in attempts per address, on top of the auth service's own per-IP
  // limits: an operator's password is worth guessing at.
  ops_login: { limit: 5, windowMs: 15 * 60_000 },
  // Second-factor attempts per account. A six-digit code is one in a million
  // per guess; five guesses in five minutes keeps it that way.
  ops_mfa: { limit: 5, windowMs: 5 * 60_000 },
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
 */
function createLimiter(scope: RateLimitScope, rule: RateLimitRule): RateLimiter {
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
