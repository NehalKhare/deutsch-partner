import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * The rollup the spend calendar reads, against a real engine.
 *
 * `cost_rollup_daily` was created, secured and schema-tested long before
 * anything wrote to it, so every historical view over it returned an empty
 * year however busy the ledger was. These are the assertions that say it is
 * filled, and filled correctly: the grouping, the UTC day boundary, and above
 * all that a second run does not double the money — the worker's scheduler is
 * an in-process clock whose ticks can happen twice.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  // Truncate, not delete: the ledger carries an append-only row trigger that
  // rejects both update and delete. Truncate is the owner-level path the
  // trigger deliberately does not cover, which is also how retention prunes.
  await database.db.query(`truncate public.cost_rollup_daily`);
  await database.db.query(`truncate public.model_invocations`);
});

interface Call {
  readonly at: string;
  readonly task?: string;
  readonly tier?: string;
  readonly model?: string;
  readonly status?: string;
  readonly costEur?: number;
  readonly inputTokens?: number;
  readonly latencyMs?: number | null;
  readonly truncated?: boolean;
}

async function record(call: Call): Promise<void> {
  await database.db.query(
    `insert into public.model_invocations
       (created_at, task, tier, provider, model_id, model_id_resolved,
        input_tokens, output_tokens, max_output_tokens, latency_ms, truncated,
        status, cost_usd, fx_rate_eur_per_usd, cost_eur)
     values ($1, $2, $3, 'openrouter', 'requested', $4,
             $5, 10, 700, $6, $7, $8, 1, 0.9, $9)`,
    [
      call.at,
      call.task ?? "conversation.turn",
      call.tier ?? "strong",
      call.model ?? "vendor/model",
      call.inputTokens ?? 100,
      call.latencyMs === undefined ? 400 : call.latencyMs,
      call.truncated ?? false,
      call.status ?? "ok",
      call.costEur ?? 1,
    ],
  );
}

const rebuild = async (from?: string, to?: string): Promise<number> => {
  const result = await database.db.query<{ rebuild_cost_rollup_daily: number }>(
    `select public.rebuild_cost_rollup_daily($1::date, $2::date)`,
    [from ?? null, to ?? null],
  );

  return Number(result.rows[0].rebuild_cost_rollup_daily);
};

/** A day well in the past and today, both as the database reckons them. */
async function dates(): Promise<readonly [string, string]> {
  const result = await database.db.query<{ old: string; today: string }>(
    `select ((now() at time zone 'utc')::date - 200)::text as old,
            (now() at time zone 'utc')::date::text as today`,
  );

  return [result.rows[0].old, result.rows[0].today];
}

const rollup = async (): Promise<ReadonlyArray<Record<string, unknown>>> => {
  const result = await database.db.query(
    `select day::text as day, task, tier, model_id_resolved, status,
            call_count, input_tokens, cost_eur::float8 as cost_eur,
            p50_latency_ms, p95_latency_ms, truncated_count
       from public.cost_rollup_daily
      order by day, task, model_id_resolved`,
  );

  return result.rows as ReadonlyArray<Record<string, unknown>>;
};

describe("rebuild_cost_rollup_daily", () => {
  it("groups the ledger by day, task, tier, model and status", async () => {
    await record({ at: "2026-05-04T09:00:00Z", costEur: 1.5 });
    await record({ at: "2026-05-04T18:00:00Z", costEur: 2.5 });
    await record({
      at: "2026-05-04T19:00:00Z",
      task: "classification.intent",
      tier: "nano",
      costEur: 0.01,
    });

    await rebuild();
    const rows = await rollup();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      day: "2026-05-04",
      task: "classification.intent",
      call_count: 1,
    });
    expect(rows[1]).toMatchObject({
      day: "2026-05-04",
      task: "conversation.turn",
      call_count: 2,
      cost_eur: 4,
    });
  });

  it("keeps a failed call in its own bucket, with its cost", async () => {
    // A call that errored still spent money, and a rollup that folded it into
    // the ok bucket would hide the error rate the guardrail view reads.
    await record({ at: "2026-05-04T09:00:00Z", costEur: 1 });
    await record({ at: "2026-05-04T10:00:00Z", status: "error", costEur: 0.4 });

    await rebuild();
    const rows = await rollup();

    expect(rows.map((row) => row.status)).toEqual(["error", "ok"]);
    expect(rows[0]).toMatchObject({ status: "error", cost_eur: 0.4 });
  });

  it("does not double the money when it runs twice over the same day", async () => {
    await record({ at: "2026-05-04T09:00:00Z", costEur: 3 });

    await rebuild();
    await rebuild();
    const rows = await rollup();

    // The scheduler is an in-process clock and two replicas can tick the same
    // hour. A rollup that accumulated would invent spend on every tick.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ call_count: 1, cost_eur: 3 });
  });

  it("picks up a row that arrived after its day was already rolled up", async () => {
    await record({ at: "2026-05-04T09:00:00Z", costEur: 1 });
    await rebuild("2026-05-04", "2026-05-04");

    await record({ at: "2026-05-04T23:59:00Z", costEur: 2 });
    await rebuild("2026-05-04", "2026-05-04");

    expect((await rollup())[0]).toMatchObject({ call_count: 2, cost_eur: 3 });
  });

  it("buckets on the UTC day, not the server's", async () => {
    // Late-evening UTC is the next day in some offsets. A call billed on the
    // 4th must not move to the 5th because of where the database is running.
    await record({ at: "2026-05-04T23:30:00Z", costEur: 1 });
    await record({ at: "2026-05-05T00:30:00Z", costEur: 1 });

    await rebuild();

    expect((await rollup()).map((row) => row.day)).toEqual([
      "2026-05-04",
      "2026-05-05",
    ]);
  });

  it("backfills the whole ledger when the rollup is empty", async () => {
    // The state this table has been in since it was created: a year of calls
    // and nothing rolled up. The first scheduled run has to find all of it,
    // not just yesterday, or the calendar starts the day the job was deployed.
    await record({ at: "2026-01-02T09:00:00Z", costEur: 1 });
    await record({ at: "2026-03-15T09:00:00Z", costEur: 1 });
    await record({ at: "2026-05-04T09:00:00Z", costEur: 1 });

    await rebuild();

    expect((await rollup()).map((row) => row.day)).toEqual([
      "2026-01-02",
      "2026-03-15",
      "2026-05-04",
    ]);
  });

  it("stops rescanning history once it has caught up", async () => {
    const [old, today] = await dates();
    await record({ at: `${old}T09:00:00Z`, costEur: 1 });
    await record({ at: `${today}T09:00:00Z`, costEur: 1 });
    await rebuild();

    // Both days are rolled up, so the next unbounded run starts from the
    // newest day it holds. Left rescanning the whole ledger every hour, this
    // is the job that quietly becomes the most expensive query in the system.
    await database.db.query(
      `update public.cost_rollup_daily set call_count = 99 where day = $1`,
      [old],
    );
    await rebuild();

    expect((await rollup()).find((row) => row.day === old)).toMatchObject({
      call_count: 99,
    });
  });

  it("fills the gap when it has not run for a while", async () => {
    const [old, today] = await dates();
    await record({ at: `${old}T09:00:00Z`, costEur: 1 });
    await rebuild();

    // The job stopped, months passed, calls kept being written. Restarting it
    // has to close the gap rather than roll up today and leave a hole — which
    // is the same window the tail case uses, measured from what it last did.
    await record({ at: `${today}T09:00:00Z`, costEur: 2 });
    await rebuild();

    expect((await rollup()).map((row) => row.day)).toEqual([old, today]);
  });

  it("counts truncations and summarises latency", async () => {
    for (const latency of [100, 200, 300, 400]) {
      await record({ at: "2026-05-04T09:00:00Z", latencyMs: latency });
    }
    await record({ at: "2026-05-04T10:00:00Z", latencyMs: 900, truncated: true });

    await rebuild();
    const row = (await rollup())[0]!;

    expect(row.truncated_count).toBe(1);
    expect(Number(row.p50_latency_ms)).toBe(300);
    expect(Number(row.p95_latency_ms)).toBeGreaterThanOrEqual(400);
  });

  it("leaves latency null when nothing recorded one", async () => {
    await record({ at: "2026-05-04T09:00:00Z", latencyMs: null });

    await rebuild();

    expect((await rollup())[0]).toMatchObject({ p50_latency_ms: null });
  });

  it("clears a day the ledger no longer has rows for", async () => {
    await record({ at: "2026-05-04T09:00:00Z", costEur: 1 });
    await rebuild("2026-05-04", "2026-05-04");

    // Retention pruned the day. The rollup must follow, or the calendar keeps
    // reporting spend whose evidence has been deleted.
    await database.db.query(`truncate public.model_invocations`);
    await rebuild("2026-05-04", "2026-05-04");

    expect(await rollup()).toEqual([]);
  });

  it("refuses a window that runs backwards", async () => {
    await expect(rebuild("2026-05-04", "2026-05-01")).rejects.toThrow();
  });
});
