import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../src/testing/harness";

let database: TestDatabase;

interface Decision {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

async function consume(key: string, limit = 2, windowSeconds = 60): Promise<Decision> {
  const result = await database.db.query<{ consume_rate_limit: Decision }>(
    `select public.consume_rate_limit($1, $2, $3) as consume_rate_limit`,
    [key, limit, windowSeconds],
  );
  return result.rows[0]!.consume_rate_limit;
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec("delete from public.rate_limit_buckets");
});

describe("consume_rate_limit", () => {
  it("allows up to the limit and then refuses", async () => {
    const first = await consume("chat:abc");
    const second = await consume("chat:abc");
    const third = await consume("chat:abc");

    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    expect(third).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("keeps callers apart", async () => {
    await consume("chat:abc");
    await consume("chat:abc");

    expect((await consume("chat:def")).allowed).toBe(true);
  });

  it("starts a new window once the old one has run its course", async () => {
    await consume("chat:abc", 1, 60);
    expect((await consume("chat:abc", 1, 60)).allowed).toBe(false);

    await database.db.query(
      `update public.rate_limit_buckets set window_start = now() - interval '2 minutes' where bucket_key = $1`,
      ["chat:abc"],
    );

    expect((await consume("chat:abc", 1, 60)).allowed).toBe(true);
  });

  it("says when the window ends", async () => {
    const decision = await consume("chat:abc", 5, 60);
    const resetAt = new Date(decision.resetAt).getTime();

    expect(resetAt).toBeGreaterThan(Date.now() + 50_000);
    expect(resetAt).toBeLessThan(Date.now() + 70_000);
  });

  it("refuses nonsense arguments rather than allowing by accident", async () => {
    await expect(consume("", 1, 60)).rejects.toThrow();
    await expect(consume("chat:abc", 0, 60)).rejects.toThrow();
  });

  it("purges buckets whose windows ended long ago", async () => {
    await consume("chat:old");
    await database.db.query(
      `update public.rate_limit_buckets set window_start = now() - interval '3 days'`,
    );
    await consume("chat:new");

    const purged = await database.db.query<{ purge_rate_limit_buckets: number }>(
      `select public.purge_rate_limit_buckets(interval '1 day') as purge_rate_limit_buckets`,
    );
    const left = await database.db.query<{ bucket_key: string }>(
      `select bucket_key from public.rate_limit_buckets`,
    );

    expect(purged.rows[0]!.purge_rate_limit_buckets).toBe(1);
    expect(left.rows.map((row) => row.bucket_key)).toEqual(["chat:new"]);
  });

  it("cannot be called by a signed-in learner", async () => {
    await expect(
      database.asLearner("11111111-1111-4111-8111-111111111111", () =>
        database.db.query(`select public.consume_rate_limit('chat:x', 1, 60)`),
      ),
    ).rejects.toThrow();
  });
});
