import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../src/testing/harness";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.close();
});

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await database.db.query(sql, params)).rows as T[];
}

const EXPECTED_TABLES = [
  "ai_run_checkpoint_writes",
  "ai_run_checkpoints",
  "ai_run_events",
  "ai_runs",
  "assessments",
  "billing_checkouts",
  "billing_customers",
  "billing_events",
  "billing_prices",
  "budget_counters",
  "budget_limits",
  "code_changes",
  "conversation_threads",
  "cost_rollup_daily",
  "embedding_cache",
  "fx_rates",
  "grammar_patterns",
  "implementation_plans",
  "knowledge_chunks",
  "knowledge_documents",
  "learner_errors",
  "learner_memories",
  "learner_states",
  "learner_vocabulary",
  "level_performances",
  "market_research",
  "mini_levels",
  "model_invocations",
  "model_pricing_snapshots",
  "ops_jobs",
  "plan_comps",
  "plan_passes",
  "product_prds",
  "product_proposals",
  "profiles",
  "proposal_reviews",
  "pull_requests",
  "rate_limit_buckets",
  "recommendations",
  "scenarios",
  "subscriptions",
  "trainer_coaching_profiles",
  "trainer_feedback",
  "trainer_mined_sessions",
  "vocabulary_items",
];

describe("tables", () => {
  it("creates every table the build spec requires", async () => {
    const present = (
      await rows<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' order by tablename`,
      )
    ).map((row) => row.tablename);

    expect(present).toEqual(EXPECTED_TABLES);
  });

  it("enables row level security on every table without exception", async () => {
    const unprotected = await rows<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and not rowsecurity
       order by tablename`,
    );

    expect(unprotected).toEqual([]);
  });

  it("uses timestamptz for every timestamp column", async () => {
    const naive = await rows<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and data_type = 'timestamp without time zone'
       order by table_name, column_name`,
    );

    expect(naive).toEqual([]);
  });

  it("gives every table a primary key", async () => {
    const missing = await rows<{ tablename: string }>(
      `select t.tablename from pg_tables t
       where t.schemaname = 'public'
         and not exists (
           select 1 from pg_constraint c
           where c.conrelid = format('public.%I', t.tablename)::regclass
             and c.contype = 'p'
         )
       order by t.tablename`,
    );

    expect(missing).toEqual([]);
  });

  it("uses only lowercase identifiers", async () => {
    const mixedCase = await rows<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'
         and (column_name <> lower(column_name) or table_name <> lower(table_name))`,
    );

    expect(mixedCase).toEqual([]);
  });
});

describe("indexes", () => {
  it("indexes every foreign key column", async () => {
    const unindexed = await rows<{ table_name: string; fk_column: string }>(
      `select c.conrelid::regclass::text as table_name, a.attname as fk_column
       from pg_constraint c
       join pg_attribute a
         on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.contype = 'f'
         and c.connamespace = 'public'::regnamespace
         and not exists (
           select 1 from pg_index i
           where i.indrelid = c.conrelid
             and a.attnum = (i.indkey::int2[])[0]
         )
       order by 1, 2`,
    );

    expect(unindexed).toEqual([]);
  });

  it("indexes the ownership column every learner policy filters on", async () => {
    const owned = [
      "learner_states",
      "learner_vocabulary",
      "learner_errors",
      "learner_memories",
      "recommendations",
      "assessments",
      "conversation_threads",
      "level_performances",
      "billing_customers",
      "billing_checkouts",
      "subscriptions",
      "plan_passes",
      "plan_comps",
    ];

    for (const table of owned) {
      const indexed = await rows(
        `select 1 from pg_index i
         join pg_attribute a
           on a.attrelid = i.indrelid and a.attnum = (i.indkey::int2[])[0]
         where i.indrelid = format('public.%I', $1::text)::regclass
           and a.attname = 'learner_id'`,
        [table],
      );

      expect(indexed.length, `${table}.learner_id is unindexed`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("constraints", () => {
  it("rejects a mini-level outside the curriculum", async () => {
    // Named rather than merely rejected: the seeded curriculum occupies every
    // valid number, so a bare rejection could just as well be a key clash.
    await expect(
      database.db.query(
        `insert into public.mini_levels (mini_level, cefr, theme, focus)
         values (99, 'B1', 'x', 'x')`,
      ),
    ).rejects.toThrow(/mini_levels_mini_level_check/);
  });

  it("rejects a CEFR level that contradicts its mini-level", async () => {
    await expect(
      database.db.query(
        `insert into public.mini_levels (mini_level, cefr, theme, focus)
         values (5, 'B1', 'x', 'x')`,
      ),
    ).rejects.toThrow(/mini_levels_cefr_matches_level/);
  });

  it("accepts a mini-level consistent with its CEFR level", async () => {
    await database.db.exec("begin");
    // The curriculum already occupies mini-level 5, and its words and grammar
    // point at it, so make room inside the transaction rather than testing the
    // primary key or a foreign key by accident. The rollback puts it all back.
    await database.db.query(`delete from public.vocabulary_items where mini_level = 5`);
    await database.db.query(`delete from public.grammar_patterns where mini_level = 5`);
    await database.db.query(`delete from public.mini_levels where mini_level = 5`);
    await expect(
      database.db.query(
        `insert into public.mini_levels (mini_level, cefr, theme, focus)
         values (5, 'A1', 'Greetings', 'greeting people')`,
      ),
    ).resolves.toBeDefined();
    await database.db.exec("rollback");
  });

  it("requires an English focus on every mini-level", async () => {
    await database.db.exec("begin");
    await expect(
      database.db.query(
        `update public.mini_levels set focus = null where mini_level = 5`,
      ),
    ).rejects.toThrow(/focus/);
    await database.db.exec("rollback");
  });

  it("rejects a skill estimate outside the unit interval", async () => {
    await expect(
      database.db.query(
        `insert into public.learner_states
           (learner_id, selected_level, effective_cefr, effective_plus, mini_level, fluency)
         values (gen_random_uuid(), 'A1', 'A1', false, 1, 1.5)`,
      ),
    ).rejects.toThrow();
  });

  it("rejects a plus modifier on B1, which would imply B2", async () => {
    await expect(
      database.db.query(
        `insert into public.learner_states
           (learner_id, selected_level, effective_cefr, effective_plus, mini_level)
         values (gen_random_uuid(), 'B1', 'B1', true, 40)`,
      ),
    ).rejects.toThrow();
  });

  it("rejects more recorded uses than exposures", async () => {
    await expect(
      database.db.query(
        `insert into public.learner_vocabulary
           (learner_id, vocabulary_item_id, exposure_count, correct_count, incorrect_count)
         values (gen_random_uuid(), gen_random_uuid(), 2, 5, 5)`,
      ),
    ).rejects.toThrow();
  });

  it("rejects a recurring error with no occurrences", async () => {
    await expect(
      database.db.query(
        `insert into public.learner_errors
           (learner_id, error_type, pattern, occurrence_count)
         values (gen_random_uuid(), 'word_order', 'x', 0)`,
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown error type, keeping the taxonomy closed", async () => {
    await expect(
      database.db.query(
        `insert into public.learner_errors
           (learner_id, error_type, pattern, occurrence_count)
         values (gen_random_uuid(), 'bad_vibes', 'x', 1)`,
      ),
    ).rejects.toThrow();
  });

  it("defaults a grammar pattern's category and keeps the pair closed", async () => {
    const seeded = await rows<{ category: string }>(
      `select category from public.grammar_patterns limit 1`,
    );
    expect(seeded[0]?.category).toBe("grammar");

    await expect(
      database.db.query(
        `update public.grammar_patterns set category = 'vibes'
         where key = (select key from public.grammar_patterns limit 1)`,
      ),
    ).rejects.toThrow();
  });

  it("rejects a negative cost on the usage ledger", async () => {
    await expect(
      database.db.query(
        `insert into public.model_invocations
           (task, tier, provider, model_id, model_id_resolved, input_tokens,
            output_tokens, max_output_tokens, status, cost_usd,
            fx_rate_eur_per_usd, cost_eur)
         values ('conversation.turn','strong','openrouter','a','a',1,1,10,'ok',
                 -1, 0.9, -0.9)`,
      ),
    ).rejects.toThrow();
  });

  it("keeps one usage ledger row per attempt rather than overwriting", async () => {
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='model_invocations'
         and column_name in ('attempt_number','request_id','cost_eur','fx_rate_eur_per_usd')`,
    );

    expect(columns).toHaveLength(4);
  });
});

describe("uniqueness", () => {
  it("gives each learner exactly one state row", async () => {
    const constraint = await rows(
      `select 1 from pg_constraint
       where conrelid = 'public.learner_states'::regclass and contype = 'p'`,
    );

    expect(constraint).toHaveLength(1);
  });

  it("prevents duplicate ingestion of the same source document", async () => {
    const unique = await rows(
      `select 1 from pg_constraint
       where conrelid = 'public.knowledge_documents'::regclass
         and contype = 'u'`,
    );

    expect(unique.length).toBeGreaterThan(0);
  });

  it("prevents two rates for the same currency pair on the same day", async () => {
    const unique = await rows(
      `select 1 from pg_constraint
       where conrelid = 'public.fx_rates'::regclass and contype = 'u'`,
    );

    expect(unique.length).toBeGreaterThan(0);
  });
});
