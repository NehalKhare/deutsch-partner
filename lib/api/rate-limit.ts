/**
 * Request-frequency limiting.
 *
 * A fixed window per learner per route, held in memory. That is a real
 * limitation and it is stated plainly: an in-memory counter is per instance,
 * so N instances allow N times the quota, and a restart forgives everyone.
 * It is here because the alternative — no limit at all on a model-generating
 * endpoint — is the thing the guardrails forbid outright, and because the
 * interface below is what a Redis or Postgres backing swaps into.
 *
 * Note what this does *not* do. Rate limiting bounds how often; it does not
 * bound spend, because one request with a large context can cost more than a
 * thousand small ones. The euro budgets in the gateway are the other half, and
 * both are required.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** When the current window ends, for a Retry-After header. */
  readonly resetAt: Date;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  /**
   * How many callers are currently being tracked.
   *
   * Exposed because it is the only observable difference between a limiter
   * that forgets old windows and one that is a memory leak with a quota
   * attached — and because it is worth a metric in its own right.
   */
  size(): number;
}

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

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
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

interface Window {
  count: number;
  startedAt: number;
}

/**
 * Entries are dropped once their window has passed, so the map is bounded by
 * the number of distinct callers inside one window rather than by all callers
 * ever seen. Without that, a limiter is a memory leak with a quota attached.
 */
export function createRateLimiter(
  rule: RateLimitRule,
  now: () => number = () => Date.now(),
): RateLimiter {
  const windows = new Map<string, Window>();

  const sweep = (at: number) => {
    for (const [key, window] of windows) {
      if (at - window.startedAt >= rule.windowMs) windows.delete(key);
    }
  };

  return {
    size: () => windows.size,

    check(key) {
      const at = now();
      sweep(at);

      const existing = windows.get(key);
      const window =
        existing && at - existing.startedAt < rule.windowMs
          ? existing
          : { count: 0, startedAt: at };

      window.count += 1;
      windows.set(key, window);

      const resetAt = new Date(window.startedAt + rule.windowMs);

      return {
        allowed: window.count <= rule.limit,
        remaining: Math.max(0, rule.limit - window.count),
        resetAt,
      };
    },
  };
}

const limiters = new Map<RateLimitScope, RateLimiter>();

/** The process-wide limiter for a scope, created on first use. */
export function limiterFor(scope: RateLimitScope): RateLimiter {
  const existing = limiters.get(scope);
  if (existing) return existing;

  const created = createRateLimiter(RATE_LIMITS[scope]);
  limiters.set(scope, created);
  return created;
}

/** Test seam: forgets every window, so one test cannot exhaust another's quota. */
export function resetRateLimiters(): void {
  limiters.clear();
}
