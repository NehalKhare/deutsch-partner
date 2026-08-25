import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ALICE, BOB, createTestDatabase, type TestDatabase } from "./harness";

/**
 * The accounting write path, against a real engine.
 *
 * Three properties matter here and none of them can be checked from the
 * application side: the row and the counters it justifies land together, a
 * written row can never be altered, and a null scope key is one key rather
 * than a new one on every call.
 */

let database: TestDatabase;

const NOW = "2026-08-21T13:00:00.000Z";
const DAY_START = "2026-08-21T00:00:00.000Z";
const DAY_END = "2026-08-22T00:00:00.000Z";
const MONTH_START = "2026-08-01T00:00:00.000Z";
const MONTH_END = "2026-09-01T00:00:00.000Z";

const HASH_ALICE = "hash-alice";
const HASH_BOB = "hash-bob";

function invocation(over: Record<string, unknown> = {}) {
  return {
    request_id: null,
    trace_id: "trace-1",
    span_id: "span-1",
    user_id_hash: HASH_ALICE,
    thread_id: null,
    message_id: null,
    task: "conversation.turn",
    tier: "strong",
    prompt_name: "conversation.turn",
    prompt_version: 1,
    prompt_fingerprint: "abcd1234",
    provider: "openrouter",
    model_id: "vendor/model",
    model_id_resolved: "vendor/model-2026-01",
    input_tokens: 900,
    output_tokens: 120,
    reasoning_tokens: null,
    cached_input_tokens: 400,
    max_output_tokens: 300,
    truncated: false,
    escalated: false,
    degraded: false,
    budget_scope_hit: null,
    attempt_number: 1,
    latency_ms: 1400,
    first_token_ms: 320,
    status: "ok",
    error_code: null,
    cost_usd: 0.002,
    fx_rate_eur_per_usd: 0.92,
    fx_stale: false,
    cost_eur: 0.00184,
    ...over,
  };
}

function increments(scopeKey: string | null, amount: number) {
  return [
    {
      scope: "per_user_daily",
      scope_key: scopeKey,
      period_start: DAY_START,
      period_end: DAY_END,
      amount_eur: amount,
    },
    {
      scope: "per_user_monthly",
      scope_key: scopeKey,
      period_start: MONTH_START,
      period_end: MONTH_END,
      amount_eur: amount,
    },
    {
      scope: "global_daily",
      scope_key: null,
      period_start: DAY_START,
      period_end: DAY_END,
      amount_eur: amount,
    },
  ];
}

async function record(
  over: Record<string, unknown> = {},
  batch: unknown[] = increments(HASH_ALICE, 0.00184),
) {
  const result = await database.db.query<{ record_model_invocation: string }>(
    `select public.record_model_invocation($1::jsonb, $2::jsonb)`,
    [JSON.stringify(invocation(over)), JSON.stringify(batch)],
  );
  return Number(result.rows[0].record_model_invocation);
}

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  // truncate, not delete: the append-only trigger is a row trigger and
  // deliberately refuses a delete, which is the point of the test below.
  await database.db.exec(`
    truncate public.model_invocations, public.budget_counters, public.budget_limits;
    truncate public.fx_rates;
  `);
});

describe("record_model_invocation", () => {
  it("writes one row and returns its id", async () => {
    const id = await record();

    const rows = await database.db.query<{ id: number; task: string; status: string }>(
      `select id, task, status from public.model_invocations`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id, task: "conversation.turn", status: "ok" });
  });

  it("ignores a key that is not a column, rather than storing it", async () => {
    // The ledger's shape is the table's, not whatever a caller serialised.
    await record({ content: "Ich hätte gern einen Kaffee." });

    const columns = await database.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'model_invocations'`,
    );

    expect(columns.rows.map((row) => row.column_name)).not.toContain("content");
  });

  it("increments each counter it is handed", async () => {
    await record();

    const counters = await database.db.query<{ scope: string; spent_eur: string }>(
      `select scope, spent_eur from public.budget_counters order by scope`,
    );

    expect(counters.rows.map((row) => row.scope)).toEqual([
      "global_daily",
      "per_user_daily",
      "per_user_monthly",
    ]);
    for (const row of counters.rows) {
      expect(Number(row.spent_eur)).toBeCloseTo(0.00184, 8);
    }
  });

  it("adds to the same counter row on the next call", async () => {
    await record();
    await record();

    const counters = await database.db.query<{ spent_eur: string }>(
      `select spent_eur from public.budget_counters where scope = 'per_user_daily'`,
    );

    expect(counters.rows).toHaveLength(1);
    expect(Number(counters.rows[0].spent_eur)).toBeCloseTo(0.00368, 8);
  });

  it("treats a null scope key as one key, not a new one per call", async () => {
    // The global scope has no key. Under the default NULLS DISTINCT rule every
    // insert would look unique, and the global budget would never fill.
    await record();
    await record();

    const counters = await database.db.query<{ spent_eur: string }>(
      `select spent_eur from public.budget_counters where scope = 'global_daily'`,
    );

    expect(counters.rows).toHaveLength(1);
    expect(Number(counters.rows[0].spent_eur)).toBeCloseTo(0.00368, 8);
  });

  it("keeps one learner's spend off another's counter", async () => {
    await record({ user_id_hash: HASH_ALICE }, increments(HASH_ALICE, 0.01));
    await record({ user_id_hash: HASH_BOB }, increments(HASH_BOB, 0.02));

    const counters = await database.db.query<{ scope_key: string; spent_eur: string }>(
      `select scope_key, spent_eur from public.budget_counters
        where scope = 'per_user_daily' order by scope_key`,
    );

    expect(counters.rows).toHaveLength(2);
    expect(Number(counters.rows[0].spent_eur)).toBeCloseTo(0.01, 8);
    expect(Number(counters.rows[1].spent_eur)).toBeCloseTo(0.02, 8);
  });

  it("moves no counter when the row itself is rejected", async () => {
    await expect(record({ status: "not_a_status" })).rejects.toThrow();

    const counters = await database.db.query(`select 1 from public.budget_counters`);

    expect(counters.rows).toHaveLength(0);
  });

  it("writes a row for a denied call, which cost nothing but still happened", async () => {
    await record(
      {
        status: "budget_denied",
        budget_scope_hit: "per_user_daily",
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        cost_eur: 0,
        fx_rate_eur_per_usd: null,
        fx_stale: true,
      },
      [],
    );

    const rows = await database.db.query<{ status: string; budget_scope_hit: string }>(
      `select status, budget_scope_hit from public.model_invocations`,
    );

    expect(rows.rows[0]).toEqual({
      status: "budget_denied",
      budget_scope_hit: "per_user_daily",
    });
  });
});

describe("the ledger is append-only", () => {
  it("refuses an update", async () => {
    await record();

    await expect(
      database.db.exec(`update public.model_invocations set cost_eur = 0`),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a delete", async () => {
    await record();

    await expect(
      database.db.exec(`delete from public.model_invocations where status = 'ok'`),
    ).rejects.toThrow(/append-only/);
  });
});

describe("euro figures are auditable", () => {
  it("refuses a euro amount with no rate behind it", async () => {
    await expect(
      record({ fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0.0019 }),
    ).rejects.toThrow(/priced_or_declared_unpriced/);
  });

  it("accepts an unpriced row that declares itself", async () => {
    await expect(
      record({ fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 }, []),
    ).resolves.toBeGreaterThan(0);
  });

  it("refuses an unpriced row that forgot to flag itself", async () => {
    await expect(
      record({ fx_rate_eur_per_usd: null, fx_stale: false, cost_eur: 0 }, []),
    ).rejects.toThrow(/priced_or_declared_unpriced/);
  });
});

describe("budget_snapshot", () => {
  beforeEach(async () => {
    await database.db.exec(`
      insert into public.budget_limits (scope, scope_key, limit_eur)
      values ('global_daily', null, 100),
             ('per_user_daily', null, 1),
             ('per_user_monthly', null, 10);
    `);
  });

  it("reports zero spend before anything has been recorded", async () => {
    const rows = await database.db.query<{ scope: string; spent_eur: string }>(
      `select scope, spent_eur from public.budget_snapshot($1, $2) order by scope`,
      [HASH_ALICE, NOW],
    );

    expect(rows.rows.map((row) => row.scope)).toEqual([
      "global_daily",
      "per_user_daily",
      "per_user_monthly",
    ]);
    expect(rows.rows.every((row) => Number(row.spent_eur) === 0)).toBe(true);
  });

  it("reports what this learner has spent today", async () => {
    await record({ user_id_hash: HASH_ALICE }, increments(HASH_ALICE, 0.25));

    const rows = await database.db.query<{ scope: string; spent_eur: string }>(
      `select scope, spent_eur from public.budget_snapshot($1, $2)
        where scope = 'per_user_daily'`,
      [HASH_ALICE, NOW],
    );

    expect(Number(rows.rows[0].spent_eur)).toBeCloseTo(0.25, 8);
  });

  it("shows one learner nothing of another's spend", async () => {
    await record({ user_id_hash: HASH_ALICE }, increments(HASH_ALICE, 0.9));

    const rows = await database.db.query<{ spent_eur: string }>(
      `select spent_eur from public.budget_snapshot($1, $2)
        where scope = 'per_user_daily'`,
      [HASH_BOB, NOW],
    );

    expect(Number(rows.rows[0].spent_eur)).toBe(0);
  });

  it("still counts one learner's spend against the global scope", async () => {
    await record({ user_id_hash: HASH_ALICE }, increments(HASH_ALICE, 0.9));

    const rows = await database.db.query<{ spent_eur: string }>(
      `select spent_eur from public.budget_snapshot($1, $2)
        where scope = 'global_daily'`,
      [HASH_BOB, NOW],
    );

    expect(Number(rows.rows[0].spent_eur)).toBeCloseTo(0.9, 8);
  });

  it("prefers a limit set for this learner over the scope's default", async () => {
    // How a free-tier or an abusive account gets a smaller budget than
    // everyone else, without a second mechanism.
    await database.db.query(
      `insert into public.budget_limits (scope, scope_key, limit_eur)
       values ('per_user_daily', $1, 0.05)`,
      [HASH_ALICE],
    );

    const alice = await database.db.query<{ limit_eur: string }>(
      `select limit_eur from public.budget_snapshot($1, $2)
        where scope = 'per_user_daily'`,
      [HASH_ALICE, NOW],
    );
    const bob = await database.db.query<{ limit_eur: string }>(
      `select limit_eur from public.budget_snapshot($1, $2)
        where scope = 'per_user_daily'`,
      [HASH_BOB, NOW],
    );

    expect(Number(alice.rows[0].limit_eur)).toBeCloseTo(0.05, 8);
    expect(Number(bob.rows[0].limit_eur)).toBe(1);
  });

  it("ignores a deactivated limit", async () => {
    await database.db.exec(
      `update public.budget_limits set active = false where scope = 'global_daily'`,
    );

    const rows = await database.db.query(
      `select scope from public.budget_snapshot($1, $2)`,
      [HASH_ALICE, NOW],
    );

    expect(rows.rows).toHaveLength(2);
  });

  it("never reports a per_request scope, which is not a persisted counter", async () => {
    await database.db.exec(
      `insert into public.budget_limits (scope, scope_key, limit_eur)
       values ('per_request', null, 0.02)`,
    );

    const rows = await database.db.query<{ scope: string }>(
      `select scope from public.budget_snapshot($1, $2)`,
      [HASH_ALICE, NOW],
    );

    expect(rows.rows.map((row) => row.scope)).not.toContain("per_request");
  });

  it("does not carry yesterday's daily spend into today", async () => {
    await record({ user_id_hash: HASH_ALICE }, [
      {
        scope: "per_user_daily",
        scope_key: HASH_ALICE,
        period_start: "2026-08-20T00:00:00.000Z",
        period_end: DAY_START,
        amount_eur: 0.99,
      },
    ]);

    const rows = await database.db.query<{ spent_eur: string }>(
      `select spent_eur from public.budget_snapshot($1, $2)
        where scope = 'per_user_daily'`,
      [HASH_ALICE, NOW],
    );

    expect(Number(rows.rows[0].spent_eur)).toBe(0);
  });
});

describe("the accounting tables are operator-only", () => {
  it("hides the ledger from a signed-in learner", async () => {
    await record();

    await database.asLearner(ALICE, async () => {
      await expect(
        database.db.query(`select * from public.model_invocations`),
      ).rejects.toThrow();
    });
  });

  it("hides it from an unauthenticated visitor", async () => {
    await database.asAnon(async () => {
      await expect(
        database.db.query(`select * from public.budget_counters`),
      ).rejects.toThrow();
    });
  });

  it("lets no learner write a ledger row", async () => {
    await database.asLearner(ALICE, async () => {
      await expect(
        database.db.query(`select public.record_model_invocation($1::jsonb, '[]'::jsonb)`, [
          JSON.stringify(invocation()),
        ]),
      ).rejects.toThrow();
    });
  });

  it("lets no learner read another learner's budget through the snapshot", async () => {
    await database.asLearner(ALICE, async () => {
      await expect(
        database.db.query(`select * from public.budget_snapshot($1, $2)`, [HASH_BOB, NOW]),
      ).rejects.toThrow();
    });
  });
});

describe("cost_dashboard", () => {
  // Rows are stamped by the database's own clock, so the window is expressed
  // against it rather than against a date written down here.
  const CALL = `public.cost_dashboard(now() - interval '1 hour', now() + interval '1 hour')`;

  async function summary() {
    const result = await database.db.query<{ cost_dashboard: unknown }>(
      `select ${CALL}`,
    );
    return result.rows[0].cost_dashboard as {
      totals: Record<string, number>;
      byTask: Array<Record<string, number | string>>;
      byModel: Array<Record<string, number | string>>;
      fxRate: Array<Record<string, unknown>>;
    };
  }

  it("sums the dollars the provider charged, not only the euro", async () => {
    // The state every deployment starts in: real spend, no rate ever
    // snapshotted, and a euro column that can only be zero. A summary that
    // reported euro alone described a working product as free.
    await record({ cost_usd: 0.004, fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 }, []);
    await record({ cost_usd: 0.006, fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 }, []);

    const totals = (await summary()).totals;

    expect(Number(totals.cost_usd)).toBeCloseTo(0.01, 8);
    expect(Number(totals.cost_eur)).toBe(0);
    expect(Number(totals.call_count)).toBe(2);
  });

  it("counts a row with no rate as unpriced", async () => {
    await record({ fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 }, []);

    const totals = (await summary()).totals;

    expect(Number(totals.unpriced)).toBe(1);
    expect(Number(totals.carried_forward)).toBe(0);
  });

  it("counts a row priced at yesterday's rate as carried forward, not unpriced", async () => {
    // Both set fx_stale, and they are not the same thing: this row is priced
    // correctly, at a rate the source published on the last day it published.
    // Counting them together is why the warning could never clear.
    await record({ fx_stale: true }, []);

    const totals = (await summary()).totals;

    expect(Number(totals.unpriced)).toBe(0);
    expect(Number(totals.carried_forward)).toBe(1);
  });

  it("separates the dollars that carry no euro figure of their own", async () => {
    // What the read layer converts at today's rate — and only this, because
    // adding a rate to the whole dollar column would count the priced rows
    // twice.
    await record({ cost_usd: 0.004, fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 }, []);
    await record({ cost_usd: 0.006 }, []);

    const totals = (await summary()).totals;

    expect(Number(totals.cost_usd)).toBeCloseTo(0.01, 8);
    expect(Number(totals.cost_usd_unpriced)).toBeCloseTo(0.004, 8);
  });

  it("reports no unpriced dollars for a window that was fully priced", async () => {
    await record({ cost_usd: 0.006 }, []);

    expect(Number((await summary()).totals.cost_usd_unpriced)).toBe(0);
  });

  it("splits the unpriced dollars down into the breakdowns too", async () => {
    await record({ cost_usd: 0.004, fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 }, []);
    await record({ cost_usd: 0.006 }, []);

    const data = await summary();

    expect(Number(data.byTask[0].costUsd)).toBeCloseTo(0.01, 8);
    expect(Number(data.byTask[0].costUsdUnpriced)).toBeCloseTo(0.004, 8);
    expect(Number(data.byModel[0].costUsdUnpriced)).toBeCloseTo(0.004, 8);
  });

  it("carries the dollars down into the per-task and per-model breakdowns", async () => {
    await record({ cost_usd: 0.004, fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 }, []);

    const data = await summary();

    expect(Number(data.byTask[0].costUsd)).toBeCloseTo(0.004, 8);
    expect(Number(data.byModel[0].costUsd)).toBeCloseTo(0.004, 8);
  });

  it("orders the breakdowns by dollars, so the order survives an unpriced window", async () => {
    await record(
      { task: "trainer.session", tier: "mid", cost_usd: 0.05, fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 },
      [],
    );
    await record(
      { task: "conversation.turn", cost_usd: 0.001, fx_rate_eur_per_usd: null, fx_stale: true, cost_eur: 0 },
      [],
    );

    const data = await summary();

    expect(data.byTask.map((row) => row.task)).toEqual([
      "trainer.session",
      "conversation.turn",
    ]);
  });

  it("states the rate behind the euro column when there is one", async () => {
    await database.db.exec(`
      insert into public.fx_rates (base_currency, quote_currency, rate, rate_date, source)
      values ('USD', 'EUR', 0.85, current_date, 'ecb');
    `);

    const rates = (await summary()).fxRate;

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ source: "ecb" });
  });

  it("reports an empty window without failing", async () => {
    const totals = (await summary()).totals;

    expect(Number(totals.call_count)).toBe(0);
    expect(Number(totals.cost_usd)).toBe(0);
    expect(Number(totals.cost_eur)).toBe(0);
  });

  it("is granted to nobody but the secret key", async () => {
    await database.asLearner(ALICE, async () => {
      await expect(database.db.query(`select ${CALL}`)).rejects.toThrow();
    });
  });
});
