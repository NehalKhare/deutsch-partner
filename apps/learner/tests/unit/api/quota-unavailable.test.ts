import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitDecision } from "@/lib/api/rate-limit";

/**
 * When the store behind the daily quotas cannot count.
 *
 * The Postgres limiter fails closed, which is right: a store that cannot
 * count cannot say anyone is within their day. But closed is not "spent".
 * Told as a spent quota, one blip would read as "you've used today's turns,
 * back tomorrow" — with an upgrade offer — to a learner who used nothing.
 */

const store = vi.hoisted(() => ({ decision: null as RateLimitDecision | null }));

vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  createLimiter: () => ({ check: async () => store.decision! }),
}));

const { consumeQuota, consumeTrainerQuota, resetQuotaLimiters } = await import("@/lib/api/quota");

const ALICE = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  resetQuotaLimiters();
});

describe("a quota store that is down", () => {
  it("is reported as unavailable, with nothing to wait for — never as a spent day", async () => {
    store.decision = { allowed: false, remaining: 0, resetAt: new Date(Date.now() + 86_400_000), unavailable: true };

    expect(await consumeQuota("free", "tutor_turns", ALICE)).toEqual({
      allowed: false,
      refusal: "unavailable",
      resetAt: null,
    });
  });

  it("is reported as unavailable to a Trainer session too, even one under way", async () => {
    store.decision = { allowed: false, remaining: 0, resetAt: new Date(Date.now() + 86_400_000), unavailable: true };

    expect(await consumeTrainerQuota("plus", ALICE, { continuing: true })).toMatchObject({
      allowed: false,
      refusal: "unavailable",
    });
  });

  it("still refuses a genuinely spent quota as spent", async () => {
    const resetAt = new Date(Date.now() + 3_600_000);
    store.decision = { allowed: false, remaining: 0, resetAt };

    expect(await consumeQuota("free", "tutor_turns", ALICE)).toEqual({
      allowed: false,
      refusal: "quota_exhausted",
      resetAt,
    });
  });
});
