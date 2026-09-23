import { describe, expect, it } from "vitest";

import { createMemoryRateLimiter } from "../src/rate-limit-repository";

/**
 * The in-memory window: the backing a process with no database credential
 * gets, and the reference behaviour the Postgres function reproduces.
 */
describe("the in-memory rate limiter", () => {
  it("allows a caller up to the quota and refuses the next one", async () => {
    const limiter = createMemoryRateLimiter({ limit: 3, windowMs: 60_000 });

    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false);
  });

  it("counts each caller separately", async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000 });

    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("b")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false);
  });

  it("starts a fresh window once the old one has passed", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 1000 }, () => now);

    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false);

    now = 1001;
    expect((await limiter.check("a")).allowed).toBe(true);
  });

  it("says when the window ends, so a caller can be told when to retry", async () => {
    let now = 5_000;
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000 }, () => now);

    await limiter.check("a");
    now = 6_000;

    expect((await limiter.check("a")).resetAt.getTime()).toBe(65_000);
  });

  it("tracks only the callers inside the current window", async () => {
    // Without this a limiter is a memory leak with a quota attached: one entry
    // per distinct caller ever seen, kept for the life of the process.
    let now = 0;
    const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 1000 }, () => now);

    for (let index = 0; index < 200; index += 1) {
      now = index * 10;
      await limiter.check(`caller-${index}`);
    }

    expect(limiter.size()).toBeLessThan(200);

    now = 100_000;
    await limiter.check("someone");
    expect(limiter.size()).toBe(1);
  });

  it("forgets a caller whose window has passed, rather than growing for ever", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 1000 }, () => now);

    for (let index = 0; index < 500; index += 1) {
      now = index * 10;
      await limiter.check(`caller-${index}`);
    }

    // The first callers' windows are long gone; a fresh check must not be
    // answered from a stale count.
    now = 100_000;
    const fresh = await limiter.check("caller-0");

    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(4);
  });
});
