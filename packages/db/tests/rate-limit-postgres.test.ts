import { describe, expect, it } from "vitest";

import { createPostgresRateLimiter } from "../src/rate-limit-repository";
import type { DatabaseClient, QueryResponse } from "../src/types";

/**
 * The Postgres window as its callers see it, over a scripted client: the
 * counting itself is consume_rate_limit's and tested in tests/db.
 *
 * What matters here is the failure. The limiter fails closed, and it says
 * that it did: a caller that cannot tell "the store is down" from "the limit
 * is reached" tells a learner their day is spent when nothing was counted.
 */

function clientAnswering(answer: () => Promise<QueryResponse>): DatabaseClient {
  return {
    from: () => {
      throw new Error("not used");
    },
    rpc: () => answer(),
  } as unknown as DatabaseClient;
}

const RULE = { limit: 20, windowMs: 86_400_000 };

describe("the Postgres rate limiter", () => {
  it("passes on what the store decided", async () => {
    const resetAt = new Date("2026-09-26T12:00:00.000Z");
    const limiter = createPostgresRateLimiter(
      clientAnswering(async () => ({ data: { allowed: false, remaining: 0, resetAt: resetAt.toISOString() }, error: null })),
      "quota",
      RULE,
    );

    const decision = await limiter.check("a");

    expect(decision).toEqual({ allowed: false, remaining: 0, resetAt });
    expect(decision.unavailable).toBeUndefined();
  });

  it.each([
    ["the call throws", async (): Promise<QueryResponse> => Promise.reject(new Error("socket hang up"))],
    ["the store answers an error", async (): Promise<QueryResponse> => ({ data: null, error: { code: "57014" } })],
    ["the store answers nonsense", async (): Promise<QueryResponse> => ({ data: { allowed: "maybe" }, error: null })],
  ])("refuses, and says the store was unavailable, when %s", async (_label, answer) => {
    const seen: string[] = [];
    const limiter = createPostgresRateLimiter(clientAnswering(answer), "quota", RULE, {
      onUnavailable: ({ errorCode }) => seen.push(errorCode),
      now: () => 0,
    });

    const decision = await limiter.check("a");

    expect(decision).toMatchObject({ allowed: false, remaining: 0, unavailable: true });
    expect(seen).toHaveLength(1);
  });
});
