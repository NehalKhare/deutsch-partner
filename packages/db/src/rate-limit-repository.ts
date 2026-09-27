import { z } from "zod";

import type { DatabaseClient } from "./types";

/**
 * Request-frequency limiting that holds across instances.
 *
 * A fixed window per caller per scope, counted in one row and moved by one
 * atomic database function, so every instance shares one quota and a restart
 * forgives nobody. Rate limiting bounds how often; the euro budgets in the
 * gateway bound spend, and both are required (guardrails S7).
 *
 * Fails closed. A store that cannot count a hit cannot say the caller is
 * within quota, and on a model-spending route that is the answer that costs
 * nothing (guardrails S26).
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** When the current window ends, for a Retry-After header. */
  readonly resetAt: Date;
  /**
   * Set when the refusal is the store's, not the limit's: nothing was
   * counted, and the window's end is a guess. A caller that shows a learner
   * "come back tomorrow" must not show it for an outage.
   */
  readonly unavailable?: true;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
}

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

const decisionSchema = z.object({
  allowed: z.boolean(),
  remaining: z.coerce.number().int().min(0),
  resetAt: z.coerce.date(),
});

export interface PostgresRateLimiterOptions {
  /** Called when the store refuses or returns nonsense. */
  readonly onUnavailable?: (detail: { scope: string; errorCode: string }) => void;
  readonly now?: () => number;
}

export function createPostgresRateLimiter(
  client: DatabaseClient,
  scope: string,
  rule: RateLimitRule,
  options: PostgresRateLimiterOptions = {},
): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const windowSeconds = Math.max(1, Math.round(rule.windowMs / 1000));

  // Closed, and marked as the store's refusal rather than the limit's.
  const denied = (): RateLimitDecision => ({
    allowed: false,
    remaining: 0,
    resetAt: new Date(now() + rule.windowMs),
    unavailable: true,
  });

  return {
    async check(key) {
      let outcome;
      try {
        outcome = await client.rpc("consume_rate_limit", {
          p_key: `${scope}:${key}`,
          p_limit: rule.limit,
          p_window_seconds: windowSeconds,
        });
      } catch {
        options.onUnavailable?.({ scope, errorCode: "thrown" });
        return denied();
      }

      if (outcome.error) {
        options.onUnavailable?.({ scope, errorCode: outcome.error.code ?? "unknown" });
        return denied();
      }

      const decision = decisionSchema.safeParse(outcome.data);
      if (!decision.success) {
        options.onUnavailable?.({ scope, errorCode: "invalid_data" });
        return denied();
      }

      return decision.data;
    },
  };
}

interface Window {
  count: number;
  startedAt: number;
}

/**
 * The same fixed window, held in memory.
 *
 * For a process with no database credential: local development without a
 * project, and the unit tests. Never the production backing — an in-memory
 * counter is per instance, so N instances would allow N times the quota.
 * Entries are dropped once their window has passed, so the map is bounded by
 * the callers inside one window rather than by all callers ever seen.
 */
export function createMemoryRateLimiter(
  rule: RateLimitRule,
  now: () => number = () => Date.now(),
): RateLimiter & { size(): number } {
  const windows = new Map<string, Window>();

  const sweep = (at: number) => {
    for (const [key, window] of windows) {
      if (at - window.startedAt >= rule.windowMs) windows.delete(key);
    }
  };

  return {
    size: () => windows.size,

    async check(key) {
      const at = now();
      sweep(at);

      const existing = windows.get(key);
      const window =
        existing && at - existing.startedAt < rule.windowMs
          ? existing
          : { count: 0, startedAt: at };

      window.count += 1;
      windows.set(key, window);

      return {
        allowed: window.count <= rule.limit,
        remaining: Math.max(0, rule.limit - window.count),
        resetAt: new Date(window.startedAt + rule.windowMs),
      };
    },
  };
}
