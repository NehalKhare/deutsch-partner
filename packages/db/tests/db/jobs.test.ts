import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * The job queue's functions against a real engine.
 *
 * What is asserted here is what the worker relies on and no unit test with a
 * fake client could show: that a claim hands one row to one caller, that a
 * duplicate request for the same subject collapses into the job already
 * waiting, that a failure retries with a delay and then stops, and that an
 * expired lock puts a job back where a live worker will find it.
 */

let database: TestDatabase;

const CORRELATION = "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

async function enqueue(
  kind = "fx.refresh",
  dedupe: string | null = kind,
  queue = "jobs",
): Promise<{ id: number; created: boolean }> {
  const result = await database.db.query<{ enqueue_job: { id: number; created: boolean } }>(
    `select public.enqueue_job($1, $2, $3::jsonb, $4::uuid, null, $5) as enqueue_job`,
    [queue, kind, JSON.stringify({ kind }), CORRELATION, dedupe],
  );
  return result.rows[0]!.enqueue_job;
}

async function claim(worker: string, queue = "jobs", lock = 90) {
  const result = await database.db.query<{ id: number; attempts: number; status: string }>(
    `select id, attempts, status from public.claim_job($1, $2, $3)`,
    [queue, worker, lock],
  );
  return result.rows[0] ?? null;
}

async function statusOf(id: number) {
  const result = await database.db.query<{ status: string; run_after: Date; last_error: string | null }>(
    `select status, run_after, last_error from public.ops_jobs where id = $1`,
    [id],
  );
  return result.rows[0]!;
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec("delete from public.ops_jobs");
});

describe("enqueue_job", () => {
  it("records a new job as queued", async () => {
    const job = await enqueue();

    expect(job.created).toBe(true);
    expect((await statusOf(job.id)).status).toBe("queued");
  });

  it("collapses a second request for the same subject into the waiting job", async () => {
    const first = await enqueue("productops.drive", "productops.drive:run-1");
    const second = await enqueue("productops.drive", "productops.drive:run-1");

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("accepts a second request once the first has finished", async () => {
    const first = await enqueue("productops.drive", "productops.drive:run-1");
    const claimed = await claim("w1");
    await database.db.query(`select public.complete_job($1, $2)`, [claimed!.id, "w1"]);

    const again = await enqueue("productops.drive", "productops.drive:run-1");

    expect(again.created).toBe(true);
    expect(again.id).not.toBe(first.id);
  });

  it("keeps jobs without a dedupe key apart", async () => {
    const a = await enqueue("ingest.knowledge", null);
    const b = await enqueue("ingest.knowledge", null);

    expect(a.id).not.toBe(b.id);
  });
});

describe("claim_job", () => {
  it("hands the oldest runnable job to exactly one caller", async () => {
    const first = await enqueue("fx.refresh", "fx.refresh");
    const second = await enqueue("pricing.snapshot", "pricing.snapshot");

    const a = await claim("w1");
    const b = await claim("w2");
    const c = await claim("w3");

    expect(a?.id).toBe(first.id);
    expect(b?.id).toBe(second.id);
    expect(c).toBeNull();
    expect(a?.attempts).toBe(1);
    expect(a?.status).toBe("running");
  });

  it("does not hand out a job from another queue", async () => {
    await enqueue("productops.implement", "productops.implement:p1", "coder");

    expect(await claim("w1", "jobs")).toBeNull();
    expect(await claim("w1", "coder")).not.toBeNull();
  });

  it("does not hand out a job before its run_after", async () => {
    await database.db.query(
      `select public.enqueue_job('jobs', 'fx.refresh', '{}'::jsonb, $1::uuid, null, null, now() + interval '1 hour')`,
      [CORRELATION],
    );

    expect(await claim("w1")).toBeNull();
  });
});

describe("finishing a job", () => {
  it("only the holder of the lock can complete it", async () => {
    await enqueue();
    const job = await claim("w1");

    const stranger = await database.db.query<{ complete_job: boolean }>(
      `select public.complete_job($1, 'w2') as complete_job`,
      [job!.id],
    );
    const holder = await database.db.query<{ complete_job: boolean }>(
      `select public.complete_job($1, 'w1') as complete_job`,
      [job!.id],
    );

    expect(stranger.rows[0]!.complete_job).toBe(false);
    expect(holder.rows[0]!.complete_job).toBe(true);
    expect((await statusOf(job!.id)).status).toBe("done");
  });

  it("retries a failure with a delay while attempts remain", async () => {
    await enqueue();
    const job = await claim("w1");

    const result = await database.db.query<{ fail_job: string }>(
      `select public.fail_job($1, 'w1', 'provider_error', 60) as fail_job`,
      [job!.id],
    );
    const after = await statusOf(job!.id);

    expect(result.rows[0]!.fail_job).toBe("queued");
    expect(after.last_error).toBe("provider_error");
    expect(after.run_after.getTime()).toBeGreaterThan(Date.now() + 30_000);
    // Not runnable yet.
    expect(await claim("w1")).toBeNull();
  });

  it("fails for good once the attempts are spent", async () => {
    await database.db.query(
      `select public.enqueue_job('jobs', 'fx.refresh', '{}'::jsonb, $1::uuid, null, null, now(), 1)`,
      [CORRELATION],
    );
    const job = await claim("w1");

    const result = await database.db.query<{ fail_job: string }>(
      `select public.fail_job($1, 'w1', 'provider_error', 0) as fail_job`,
      [job!.id],
    );

    expect(result.rows[0]!.fail_job).toBe("failed");
    expect((await statusOf(job!.id)).status).toBe("failed");
  });

  it("puts a job whose lock expired back in the queue", async () => {
    await enqueue();
    const job = await claim("w1", "jobs", 5);
    await database.db.query(
      `update public.ops_jobs set lock_expires_at = now() - interval '1 minute' where id = $1`,
      [job!.id],
    );

    const moved = await database.db.query<{ requeue_expired_jobs: number }>(
      `select public.requeue_expired_jobs() as requeue_expired_jobs`,
    );

    expect(moved.rows[0]!.requeue_expired_jobs).toBe(1);
    const after = await statusOf(job!.id);
    expect(after.status).toBe("queued");
    expect(after.last_error).toBe("lock_expired");
    expect((await claim("w2"))?.id).toBe(job!.id);
  });

  it("keeps a live lock alive through a heartbeat", async () => {
    await enqueue();
    const job = await claim("w1", "jobs", 5);

    const beat = await database.db.query<{ heartbeat_job: boolean }>(
      `select public.heartbeat_job($1, 'w1', 600) as heartbeat_job`,
      [job!.id],
    );
    const moved = await database.db.query<{ requeue_expired_jobs: number }>(
      `select public.requeue_expired_jobs() as requeue_expired_jobs`,
    );

    expect(beat.rows[0]!.heartbeat_job).toBe(true);
    expect(moved.rows[0]!.requeue_expired_jobs).toBe(0);
  });
});

describe("who may touch the queue", () => {
  it("is invisible to a signed-in learner", async () => {
    await enqueue();

    await expect(
      database.asLearner("11111111-1111-4111-8111-111111111111", () =>
        database.db.query("select count(*) from public.ops_jobs"),
      ),
    ).rejects.toThrow();
    await expect(
      database.asLearner("11111111-1111-4111-8111-111111111111", () =>
        database.db.query("select public.claim_job('jobs', 'x')"),
      ),
    ).rejects.toThrow();
  });
});

describe("the widened kind constraint", () => {
  it("accepts a cost.rollup job, which the first constraint refused", async () => {
    const job = await enqueue("cost.rollup");

    expect(job.created).toBe(true);
    expect((await statusOf(job.id)).status).toBe("queued");
  });
});

describe("claiming around the slow kinds", () => {
  const SLOW = ["productops.drive", "productops.implement", "ingest.knowledge"];

  async function claimExcluding(worker: string, excluded: readonly string[]) {
    const result = await database.db.query<{ id: number; kind: string }>(
      `select id, kind from public.claim_job($1, $2, $3, $4)`,
      ["jobs", worker, 90, excluded as string[]],
    );
    return result.rows[0] ?? null;
  }

  it("skips the excluded kinds and hands out the next fast job", async () => {
    await enqueue("productops.drive", "productops.drive:run-1");
    await enqueue("fx.refresh");

    const claimed = await claimExcluding("w1", SLOW);

    expect(claimed?.kind).toBe("fx.refresh");
  });

  it("hands out nothing when only excluded kinds wait", async () => {
    await enqueue("ingest.knowledge");

    expect(await claimExcluding("w1", SLOW)).toBeNull();
    // The job is still there for a worker with a free slow slot.
    expect((await claim("w2"))?.status).toBe("running");
  });
});

describe("job_queue_stats", () => {
  it("counts rows by queue and status", async () => {
    await enqueue("fx.refresh");
    await enqueue("ratelimit.purge");
    const claimed = await claim("w1");
    await database.db.query(`select public.fail_job($1, $2, $3, 0, true)`, [
      claimed!.id,
      "w1",
      "store_unavailable",
    ]);

    const result = await database.db.query<{ queue: string; status: string; count: number }>(
      `select queue, status, count from public.job_queue_stats() order by status`,
    );

    expect(result.rows).toEqual([
      expect.objectContaining({ queue: "jobs", status: "failed", count: 1 }),
      expect.objectContaining({ queue: "jobs", status: "queued", count: 1 }),
    ]);
  });

  it("is not a learner's to call", async () => {
    await expect(
      database.asLearner("11111111-1111-4111-8111-111111111111", () =>
        database.db.query("select * from public.job_queue_stats()"),
      ),
    ).rejects.toThrow();
  });
});

describe("enqueue_scheduled_job", () => {
  async function enqueueScheduled(kind: string, extra?: Record<string, unknown>) {
    const result = await database.db.query<{ enqueue_scheduled_job: { id: number; created: boolean } }>(
      `select public.enqueue_scheduled_job($1, $2::jsonb) as enqueue_scheduled_job`,
      [kind, JSON.stringify(extra ?? {})],
    );
    return result.rows[0]!.enqueue_scheduled_job;
  }

  async function payloadOf(id: number): Promise<unknown> {
    const result = await database.db.query<{ payload: unknown; correlation_id: string; dedupe_key: string }>(
      `select payload, correlation_id, dedupe_key from public.ops_jobs where id = $1`,
      [id],
    );
    return result.rows[0]!;
  }

  it("builds the envelope the worker's schema accepts", async () => {
    const { jobPayloadSchema } = await import("@dp/domain/jobs");
    const job = await enqueueScheduled("fx.refresh");
    const row = (await payloadOf(job.id)) as {
      payload: { kind: string; correlationId: string; source: string };
      correlation_id: string;
      dedupe_key: string;
    };

    const parsed = jobPayloadSchema.safeParse(row.payload);
    expect(parsed.success).toBe(true);
    expect(row.payload.source).toBe("scheduler");
    // The row and the envelope tell one story.
    expect(row.payload.correlationId).toBe(row.correlation_id);
    expect(row.dedupe_key).toBe("fx.refresh");
  });

  it("collapses a second tick into the job already waiting", async () => {
    const first = await enqueueScheduled("pricing.snapshot");
    const second = await enqueueScheduled("pricing.snapshot");

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("carries extras like the rollup window into the payload", async () => {
    const { jobPayloadSchema } = await import("@dp/domain/jobs");
    const job = await enqueueScheduled("cost.rollup", { sinceDays: 2 });
    const row = (await payloadOf(job.id)) as { payload: unknown };

    const parsed = jobPayloadSchema.parse(row.payload);
    expect(parsed).toMatchObject({ kind: "cost.rollup", sinceDays: 2 });
  });
});
