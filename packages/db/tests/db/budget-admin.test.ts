import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBudgetRepository } from "../../src/budget-repository";
import { LEDGER_COLUMNS, invocationSchema } from "../../src/ledger-repository";
import { ALICE, createTestDatabase, type TestDatabase } from "../../src/testing/harness";
import { createPgliteClient } from "../../src/testing/pglite-client";

/**
 * The operator's budget and pricing functions, against a real engine.
 *
 * What only Postgres can confirm: that an edit lands on the row the gate reads
 * (the unique key treats a null scope key as a value), that the refusals the
 * form makes are made again below it, that the overview reports the limit the
 * gate would actually apply to a learner, and that none of it is reachable
 * from a learner's session.
 */

let database: TestDatabase;

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = "2026-09-23T15:00:00Z";
const TODAY = "2026-09-23T00:00:00Z";
const TOMORROW = "2026-09-24T00:00:00Z";
const MONTH = "2026-09-01T00:00:00Z";
const NEXT_MONTH = "2026-10-01T00:00:00Z";

/** budget_limits as the migrations leave it, before any test clears it. */
let seeded: Array<{ scope: string; scope_key: string | null; limit_eur: string; warn_pct: string; degrade_pct: string; active: boolean }>;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedLearner(ALICE);
  seeded = (
    await database.db.query<(typeof seeded)[number]>(
      `select scope, scope_key, limit_eur, warn_pct, degrade_pct, active
         from public.budget_limits order by scope, scope_key`,
    )
  ).rows;
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec(`
    delete from public.budget_limits;
    delete from public.budget_counters;
    delete from public.model_pricing_snapshots;
    delete from public.fx_rates;
  `);
});

interface Change {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

async function setLimit(
  scope: string,
  key: string | null,
  limit: string,
  over: { warn?: string; degrade?: string; active?: boolean } = {},
): Promise<Change> {
  const result = await database.db.query<{ change: Change }>(
    `select public.set_budget_limit($1, $2, $3::numeric, $4::numeric, $5::numeric, $6) as change`,
    [scope, key, limit, over.warn ?? "0.70", over.degrade ?? "0.90", over.active ?? true],
  );
  return result.rows[0].change;
}

async function count(scope: string, key: string | null, start: string, end: string, spent: string) {
  await database.db.query(
    `insert into public.budget_counters (scope, scope_key, period_start, period_end, spent_eur)
     values ($1, $2, $3, $4, $5::numeric)`,
    [scope, key, start, end, spent],
  );
}

async function refusal(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("set_budget_limit", () => {
  it("creates a scope's default, then edits that same row", async () => {
    const created = await setLimit("global_daily", null, "50");
    expect(created.before).toBeNull();
    expect(created.after).toMatchObject({ scope: "global_daily", scope_key: null, active: true });
    expect(Number(created.after.limit_eur)).toBe(50);

    const edited = await setLimit("global_daily", null, "40.5", { warn: "0.60", degrade: "0.80" });
    expect(Number(edited.before?.limit_eur)).toBe(50);
    expect(Number(edited.after.limit_eur)).toBe(40.5);
    expect(Number(edited.after.warn_pct)).toBe(0.6);

    const rows = await database.db.query(`select * from public.budget_limits`);
    // One row: a null key is a value to the unique constraint, not a wildcard.
    expect(rows.rows).toHaveLength(1);
  });

  it("keeps a learner's override apart from the scope's default", async () => {
    await setLimit("per_user_daily", null, "0.50");
    await setLimit("per_user_daily", HASH_A, "2");

    const rows = await database.db.query<{ scope_key: string | null }>(
      `select scope_key from public.budget_limits order by scope_key nulls first`,
    );
    expect(rows.rows.map((row) => row.scope_key)).toEqual([null, HASH_A]);
  });

  it("writes what the gate then reads for that learner", async () => {
    await setLimit("per_user_daily", null, "0.50");
    await setLimit("per_user_daily", HASH_A, "2");

    const snapshot = await database.db.query<{ scope: string; limit_eur: string }>(
      `select scope, limit_eur from public.budget_snapshot($1, $2::timestamptz)`,
      [HASH_A, NOW],
    );
    expect(snapshot.rows.map((row) => [row.scope, Number(row.limit_eur)])).toEqual([
      ["per_user_daily", 2],
    ]);
  });

  it("refuses per_request, which nothing reads from the table", async () => {
    expect(await refusal(() => setLimit("per_request", null, "0.05"))).toBe("22023");
  });

  it("refuses a key on the global scope", async () => {
    expect(await refusal(() => setLimit("global_daily", HASH_A, "5"))).toBe("22023");
  });

  it("refuses to switch a scope's default off, and allows pausing an override", async () => {
    expect(
      await refusal(() => setLimit("per_user_monthly", null, "5", { active: false })),
    ).toBe("22023");

    const paused = await setLimit("per_user_monthly", HASH_A, "5", { active: false });
    expect(paused.after.active).toBe(false);
  });

  it("leaves warn-before-degrade to the table's own check", async () => {
    expect(
      await refusal(() => setLimit("global_daily", null, "5", { warn: "0.95", degrade: "0.90" })),
    ).toBe("23514");
  });
});

describe("set_budget_limit with a plan", () => {
  it("keeps a plan's default apart from the scope's and from a learner's", async () => {
    await setLimit("per_user_monthly", null, "10");
    await setLimit("per_user_monthly", "plan:plus", "4");
    await setLimit("per_user_monthly", HASH_A, "20");

    const rows = await database.db.query<{ scope_key: string | null }>(
      `select scope_key from public.budget_limits order by scope_key nulls first`,
    );
    expect(rows.rows.map((row) => row.scope_key)).toEqual([null, HASH_A, "plan:plus"]);
  });

  it("edits a plan's default in place", async () => {
    await setLimit("per_user_monthly", "plan:free", "1");
    const edited = await setLimit("per_user_monthly", "plan:free", "0.80");

    expect(Number(edited.before?.limit_eur)).toBe(1);
    expect(Number(edited.after.limit_eur)).toBe(0.8);
  });

  it("refuses a plan that does not exist, and a key that is neither a pseudonym nor a plan", async () => {
    // The form refuses both first; this is the refusal below it.
    for (const key of ["plan:gold", "alice@example.com", "11111111-1111-4111-8111-111111111111"]) {
      expect(await refusal(() => setLimit("per_user_monthly", key, "1")), key).toBe("22023");
    }
  });

  it("refuses a plan key on the global scope", async () => {
    expect(await refusal(() => setLimit("global_daily", "plan:free", "5"))).toBe("22023");
  });

  it("refuses to switch a plan's default off", async () => {
    expect(
      await refusal(() => setLimit("per_user_monthly", "plan:free", "1", { active: false })),
    ).toBe("22023");
  });
});

describe("remove_budget_override", () => {
  it("removes one learner's override and returns what it was", async () => {
    await setLimit("per_user_daily", HASH_A, "2");

    const result = await database.db.query<{ removed: Record<string, unknown> | null }>(
      `select public.remove_budget_override('per_user_daily', $1) as removed`,
      [HASH_A],
    );
    expect(result.rows[0].removed).toMatchObject({ scope_key: HASH_A });

    const rows = await database.db.query(`select * from public.budget_limits`);
    expect(rows.rows).toHaveLength(0);
  });

  it("never removes a plan's default", async () => {
    await setLimit("per_user_monthly", "plan:premium", "9");

    const result = await database.db.query<{ removed: unknown }>(
      `select public.remove_budget_override('per_user_monthly', 'plan:premium') as removed`,
    );
    expect(result.rows[0].removed).toBeNull();

    const rows = await database.db.query(`select * from public.budget_limits`);
    expect(rows.rows).toHaveLength(1);
  });

  it("never removes a scope's default", async () => {
    await setLimit("per_user_daily", null, "0.50");

    const result = await database.db.query<{ removed: unknown }>(
      `select public.remove_budget_override('per_user_daily', null) as removed`,
    );
    expect(result.rows[0].removed).toBeNull();

    const rows = await database.db.query(`select * from public.budget_limits`);
    expect(rows.rows).toHaveLength(1);
  });
});

describe("the plans' starting budgets", () => {
  it("are seeded as spec S9 states them, per learner per month", () => {
    const plans = seeded
      .filter((row) => row.scope_key?.startsWith("plan:"))
      .map((row) => [row.scope, row.scope_key, Number(row.limit_eur), Number(row.degrade_pct), row.active]);

    // Degraded one tier at 90%, refused at 100% (spec S9, routing S9).
    expect(plans).toEqual([
      ["per_user_monthly", "plan:free", 1, 0.9, true],
      ["per_user_monthly", "plan:plus", 4, 0.9, true],
      ["per_user_monthly", "plan:premium", 9, 0.9, true],
    ]);
  });

  it("are the only rows the migrations write: every other limit is an operator's decision", () => {
    expect(seeded.filter((row) => !row.scope_key?.startsWith("plan:"))).toEqual([]);
  });
});

interface SnapshotRow {
  scope: string;
  scope_key: string | null;
  limit_eur: string;
  spent_eur: string;
}

async function snapshotFor(hash: string | null, plan?: string | null): Promise<Record<string, SnapshotRow>> {
  const result =
    plan === undefined
      ? await database.db.query<SnapshotRow>(
          `select scope, scope_key, limit_eur, spent_eur from public.budget_snapshot($1, $2::timestamptz)`,
          [hash, NOW],
        )
      : await database.db.query<SnapshotRow>(
          `select scope, scope_key, limit_eur, spent_eur from public.budget_snapshot($1, $2::timestamptz, $3)`,
          [hash, NOW, plan],
        );
  return Object.fromEntries(result.rows.map((row) => [row.scope, row]));
}

const limitOf = (rows: Record<string, SnapshotRow>, scope: string) =>
  rows[scope] === undefined ? undefined : Number(rows[scope].limit_eur);

describe("budget_snapshot with a plan", () => {
  beforeEach(async () => {
    await setLimit("global_daily", null, "50");
    await setLimit("per_user_monthly", null, "10");
    await setLimit("per_user_monthly", "plan:free", "1");
    await setLimit("per_user_monthly", "plan:premium", "9");
  });

  it("applies the plan's default in place of the scope's", async () => {
    expect(limitOf(await snapshotFor(HASH_A, "free"), "per_user_monthly")).toBe(1);
    expect(limitOf(await snapshotFor(HASH_A, "premium"), "per_user_monthly")).toBe(9);
  });

  it("lets a learner's own override beat their plan's default", async () => {
    // How support gives one heavy free learner more room, or an abusive one less.
    await setLimit("per_user_monthly", HASH_A, "3");

    expect(limitOf(await snapshotFor(HASH_A, "free"), "per_user_monthly")).toBe(3);
    expect(limitOf(await snapshotFor(HASH_B, "free"), "per_user_monthly")).toBe(1);
  });

  it("falls back to the scope's default for a plan with no row of its own", async () => {
    expect(limitOf(await snapshotFor(HASH_A, "plus"), "per_user_monthly")).toBe(10);
  });

  it("falls back to the scope's default when the plan's row is inactive", async () => {
    // Not reachable from the form, which refuses it; the gate agrees anyway.
    await database.db.exec(`update public.budget_limits set active = false where scope_key = 'plan:free'`);

    expect(limitOf(await snapshotFor(HASH_A, "free"), "per_user_monthly")).toBe(10);
  });

  it("resolves exactly as before when the call names no plan", async () => {
    // Every call site until plans are enforced: the plan rows must be invisible to it.
    const twoArguments = await snapshotFor(HASH_A);
    const nullPlan = await snapshotFor(HASH_A, null);

    expect(limitOf(twoArguments, "per_user_monthly")).toBe(10);
    expect(nullPlan).toEqual(twoArguments);
  });

  it("does not match a plan it does not know", async () => {
    expect(limitOf(await snapshotFor(HASH_A, "gold"), "per_user_monthly")).toBe(10);
  });

  it("leaves the global scope to its own row, whatever the plan", async () => {
    expect(limitOf(await snapshotFor(HASH_A, "free"), "global_daily")).toBe(50);
  });

  it("gives a per-learner scope a plan's row even where the scope has no default", async () => {
    await setLimit("per_user_daily", "plan:free", "0.10");

    expect(limitOf(await snapshotFor(HASH_A, "free"), "per_user_daily")).toBe(0.1);
    expect(limitOf(await snapshotFor(HASH_A, "premium"), "per_user_daily")).toBeUndefined();
  });

  it("still counts the learner's own spend, never the plan's together", async () => {
    // A plan bounds each of its learners; the counter stays keyed by the learner.
    await count("per_user_monthly", HASH_A, MONTH, NEXT_MONTH, "0.75");
    await count("per_user_monthly", HASH_B, MONTH, NEXT_MONTH, "0.20");

    const alice = await snapshotFor(HASH_A, "free");
    expect(alice.per_user_monthly).toMatchObject({ scope_key: HASH_A });
    expect(Number(alice.per_user_monthly?.spent_eur)).toBe(0.75);
    expect(Number((await snapshotFor(HASH_B, "free")).per_user_monthly?.spent_eur)).toBe(0.2);
  });
});

interface Overview {
  limits: Array<{ scope: string; scopeKey: string | null; limitEur: number }>;
  globalSpentEur: number;
  learners: Array<{
    scope: string;
    userIdHash: string;
    spentEur: number;
    limitEur: number | null;
    overridden: boolean;
  }>;
  learnerCounts: { daily: number; monthly: number };
  dayStart: string;
  monthStart: string;
}

async function overview(top = 20): Promise<Overview> {
  const result = await database.db.query<{ overview: Overview }>(
    `select public.budget_overview($1::timestamptz, $2) as overview`,
    [NOW, top],
  );
  return result.rows[0].overview;
}

describe("budget_overview", () => {
  it("is a document with empty lists when nothing is configured or spent", async () => {
    const result = await overview();

    expect(result.limits).toEqual([]);
    expect(result.learners).toEqual([]);
    expect(Number(result.globalSpentEur)).toBe(0);
    expect(result.learnerCounts).toEqual({ daily: 0, monthly: 0 });
  });

  it("reports today's global spend and not yesterday's", async () => {
    await count("global_daily", null, TODAY, TOMORROW, "12.5");
    await count("global_daily", null, "2026-09-22T00:00:00Z", TODAY, "99");

    expect(Number((await overview()).globalSpentEur)).toBe(12.5);
  });

  it("ranks learners by spend and shows the limit the gate would apply to each", async () => {
    await setLimit("per_user_daily", null, "0.50");
    await setLimit("per_user_daily", HASH_B, "3");
    await count("per_user_daily", HASH_A, TODAY, TOMORROW, "0.40");
    await count("per_user_daily", HASH_B, TODAY, TOMORROW, "1.20");

    const daily = (await overview()).learners.filter((row) => row.scope === "per_user_daily");

    expect(
      daily.map((row) => [row.userIdHash, Number(row.spentEur), Number(row.limitEur), row.overridden]),
    ).toEqual([
      [HASH_B, 1.2, 3, true],
      [HASH_A, 0.4, 0.5, false],
    ]);
  });

  it("ignores a paused override, as the gate does", async () => {
    await setLimit("per_user_daily", null, "0.50");
    await setLimit("per_user_daily", HASH_A, "3", { active: false });
    await count("per_user_daily", HASH_A, TODAY, TOMORROW, "0.40");

    const [row] = (await overview()).learners;
    expect(Number(row?.limitEur)).toBe(0.5);
    expect(row?.overridden).toBe(false);
  });

  it("reads the month's counters for the monthly scope", async () => {
    await count("per_user_monthly", HASH_A, MONTH, NEXT_MONTH, "4");
    await count("per_user_monthly", HASH_B, "2026-08-01T00:00:00Z", MONTH, "40");

    const result = await overview();
    const monthly = result.learners.filter((row) => row.scope === "per_user_monthly");

    expect(monthly.map((row) => row.userIdHash)).toEqual([HASH_A]);
    // No limit configured is reported as none, not as zero.
    expect(monthly[0]?.limitEur).toBeNull();
    expect(result.learnerCounts).toEqual({ daily: 0, monthly: 1 });
  });

  it("lists a plan's default among the limits and never as a learner", async () => {
    await setLimit("per_user_monthly", null, "10");
    await setLimit("per_user_monthly", "plan:free", "1");
    await count("per_user_monthly", HASH_A, MONTH, NEXT_MONTH, "4");

    const result = await overview();

    expect(result.limits.map((row) => row.scopeKey)).toEqual([null, "plan:free"]);
    expect(result.learners.map((row) => row.userIdHash)).toEqual([HASH_A]);
    // Against the scope's default: the counters do not say which plan a
    // pseudonym is on, so the overview cannot, and does not pretend to.
    expect(Number(result.learners[0]?.limitEur)).toBe(10);
    expect(result.learners[0]?.overridden).toBe(false);
  });

  it("caps the list per scope and still counts everyone", async () => {
    await count("per_user_daily", HASH_A, TODAY, TOMORROW, "1");
    await count("per_user_daily", HASH_B, TODAY, TOMORROW, "2");

    const result = await overview(1);
    expect(result.learners.map((row) => row.userIdHash)).toEqual([HASH_B]);
    expect(result.learnerCounts.daily).toBe(2);
  });
});

interface Pricing {
  models: Array<{
    provider: string;
    modelId: string;
    inputUsdPerToken: number;
    outputUsdPerToken: number;
    fetchedAt: string;
    snapshots: number;
    previous: { inputUsdPerToken: number; outputUsdPerToken: number; fetchedAt: string } | null;
  }>;
  fx: Array<{ rate: number; rateDate: string; source: string }>;
  lastFetchedAt: string | null;
}

async function pricing(days = 30): Promise<Pricing> {
  const result = await database.db.query<{ pricing: Pricing }>(
    `select public.pricing_overview($1) as pricing`,
    [days],
  );
  return result.rows[0].pricing;
}

async function snapshot(model: string, input: string, output: string, at: string) {
  await database.db.query(
    `insert into public.model_pricing_snapshots
       (provider, model_id, input_price_per_token, output_price_per_token, fetched_at)
     values ('openrouter', $1, $2::numeric, $3::numeric, $4)`,
    [model, input, output, at],
  );
}

describe("pricing_overview", () => {
  it("is a document with empty lists before anything was fetched", async () => {
    expect(await pricing()).toEqual({ models: [], fx: [], lastFetchedAt: null });
  });

  it("shows each model's newest price and the last one that differed", async () => {
    await snapshot("vendor/a", "0.000001", "0.000002", "2026-09-20T04:13:00Z");
    await snapshot("vendor/a", "0.000003", "0.000004", "2026-09-21T04:13:00Z");
    await snapshot("vendor/a", "0.000003", "0.000004", "2026-09-22T04:13:00Z");
    await snapshot("vendor/b", "0.0000005", "0.0000005", "2026-09-22T04:13:00Z");

    const result = await pricing();
    const [a, b] = result.models;

    expect(result.models.map((row) => row.modelId)).toEqual(["vendor/a", "vendor/b"]);
    expect(Number(a?.inputUsdPerToken)).toBe(0.000003);
    expect(a?.snapshots).toBe(3);
    expect(Number(a?.previous?.inputUsdPerToken)).toBe(0.000001);
    expect(a?.previous?.fetchedAt).toContain("2026-09-20");
    expect(b?.previous).toBeNull();
    expect(result.lastFetchedAt).toContain("2026-09-22");
  });

  it("lists the euro rates newest first, as many days as asked", async () => {
    for (const [day, value] of [["2026-09-20", "0.91"], ["2026-09-21", "0.92"], ["2026-09-22", "0.93"]]) {
      await database.db.query(
        `insert into public.fx_rates (base_currency, quote_currency, rate, rate_date, source)
         values ('USD', 'EUR', $1::numeric, $2::date, 'ecb')`,
        [value, day],
      );
    }

    const result = await pricing(2);
    expect(result.fx.map((row) => row.rateDate)).toEqual(["2026-09-22", "2026-09-21"]);
  });
});

describe("the ledger explorer's columns", () => {
  it("are all real, and a row Postgres returns parses", async () => {
    await database.db.exec(`truncate public.model_invocations`);
    await database.db.query(
      `insert into public.model_invocations
         (task, tier, provider, model_id, model_id_resolved, input_tokens, output_tokens,
          max_output_tokens, status, cost_usd, fx_rate_eur_per_usd, cost_eur, request_id)
       values ('conversation.turn', 'strong', 'openrouter', 'vendor/a', 'vendor/a', 10, 5,
               700, 'ok', 0.001, 0.92, 0.00092, gen_random_uuid())`,
    );

    const result = await database.db.query(`select ${LEDGER_COLUMNS} from public.model_invocations`);
    const parsed = invocationSchema.safeParse(result.rows[0]);

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.costEur).toBeCloseTo(0.00092);
  });
});

describe("the repository, against the real functions", () => {
  it("saves a plan's default and reads it back as a limit", async () => {
    const budgets = createBudgetRepository(createPgliteClient(database.db));

    const saved = await budgets.setLimit({
      scope: "per_user_monthly",
      scopeKey: "plan:plus",
      limitEur: "4.50",
      warnPct: "0.70",
      degradePct: "0.90",
      active: true,
    });
    expect(saved.ok && saved.data.after).toMatchObject({ scopeKey: "plan:plus", limitEur: 4.5 });

    const read = await budgets.overview(new Date(NOW));
    expect(read.ok && read.data.limits.map((row) => row.scopeKey)).toEqual(["plan:plus"]);
  });

  it("refuses to remove a plan's default before asking the database", async () => {
    await setLimit("per_user_monthly", "plan:plus", "4");
    const budgets = createBudgetRepository(createPgliteClient(database.db));

    const removed = await budgets.removeOverride({ scope: "per_user_monthly", scopeKey: "plan:plus" });

    expect(removed).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    const rows = await database.db.query(`select * from public.budget_limits`);
    expect(rows.rows).toHaveLength(1);
  });
});

describe("from a learner's session", () => {
  it.each([
    [`select public.budget_snapshot('${HASH_A}', now(), 'premium')`],
    [`select public.budget_overview()`],
    [`select public.set_budget_limit('global_daily', null, 1000, 0.7, 0.9, true)`],
    [`select public.remove_budget_override('per_user_daily', '${HASH_A}')`],
    [`select public.pricing_overview()`],
  ])("%s is refused", async (sql) => {
    const code = await refusal(() => database.asLearner(ALICE, () => database.db.query(sql)));
    expect(code).toBe("42501");
  });
});
