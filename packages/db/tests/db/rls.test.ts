import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ALICE,
  BOB,
  createTestDatabase,
  type TestDatabase,
} from "../../src/testing/harness";

/**
 * The Phase 2 requirement: cross-user access must be denied by the database,
 * not by application code. These run against real Postgres with real RLS.
 */

let database: TestDatabase;

/** Tables owned by a learner, with the column carrying that ownership. */
const OWNED_TABLES = [
  "learner_states",
  "learner_vocabulary",
  "learner_errors",
  "learner_memories",
  "recommendations",
  "assessments",
  "conversation_threads",
  "level_performances",
  "trainer_coaching_profiles",
] as const;

const REFERENCE_TABLES = [
  "mini_levels",
  "vocabulary_items",
  "grammar_patterns",
  "knowledge_documents",
  "knowledge_chunks",
] as const;

const OPERATOR_TABLES = [
  "model_invocations",
  "fx_rates",
  "model_pricing_snapshots",
  "budget_limits",
  "budget_counters",
  "cost_rollup_daily",
  "embedding_cache",
  "ops_jobs",
  "rate_limit_buckets",
  "billing_prices",
  "billing_events",
] as const;

/** A learner's billing rows: theirs to read, never theirs to write. */
const BILLING_TABLES = [
  "billing_customers",
  "billing_checkouts",
  "subscriptions",
  "plan_passes",
  "plan_comps",
] as const;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedReferenceData();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);

  // Each learner owns one thread, one level tally and one coaching profile.
  for (const learner of [ALICE, BOB]) {
    await database.db.query(
      `insert into public.trainer_coaching_profiles (learner_id, explanation_depth)
       values ($1, 'brief')`,
      [learner],
    );
    await database.db.query(
      `insert into public.conversation_threads
         (id, learner_id, title, topic, cefr, mini_level, mode)
       values ($1, $2, $3, 'daily_life', 'A1', 1, 'free_chat')`,
      [threadIdFor(learner), learner, `${learner} thread`],
    );
    await database.db.query(
      `insert into public.level_performances
         (learner_id, mini_level, turns, strong_turns)
       values ($1, 1, 2, 1)`,
      [learner],
    );
  }

  // And one of each billing row, written as the webhook writes them: with the
  // secret key, which bypasses RLS. The harness runs as the table owner.
  for (const [learner, tag] of [[ALICE, "Alice"], [BOB, "Bob0"]] as const) {
    await database.db.query(
      `insert into public.billing_customers (learner_id, stripe_customer_id) values ($1, $2)`,
      [learner, `cus_${tag}`],
    );
    await database.db.query(
      `insert into public.billing_checkouts (learner_id, offer_key, kind, terms_version, early_start_consent_at)
       values ($1, 'dp_plus_month', 'order', '2026-09-25', now())`,
      [learner],
    );
    await database.db.query(
      `insert into public.subscriptions
         (learner_id, stripe_subscription_id, stripe_price_id, plan_code, status, stripe_synced_at)
       values ($1, $2, 'price_Plus', 'plus', 'active', now())`,
      [learner, `sub_${tag}`],
    );
    await database.db.query(
      `insert into public.plan_passes
         (learner_id, plan_code, starts_at, ends_at, stripe_checkout_session_id, amount_minor, currency)
       values ($1, 'plus', now(), now() + interval '180 days', $2, 100, 'eur')`,
      [learner, `cs_test_${tag}`],
    );
    await database.db.query(
      `insert into public.plan_comps (learner_id, plan_code, reason)
       values ($1, 'premium', 'operator')`,
      [learner],
    );
  }
});

afterAll(async () => {
  await database?.close();
});

function threadIdFor(learner: string) {
  return learner === ALICE
    ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
}

/**
 * A valid row per owned table, parameterised only on the learner id. Using a
 * complete row means an insert can only be rejected by the RLS policy, which
 * is what these tests are actually about.
 */
const MINIMAL_INSERT: Record<(typeof OWNED_TABLES)[number], string> = {
  learner_states: `insert into public.learner_states
      (learner_id, selected_level, effective_cefr, effective_plus, mini_level)
    values ($1, 'A1', 'A1', false, 1)`,
  learner_vocabulary: `insert into public.learner_vocabulary
      (learner_id, vocabulary_item_id)
    values ($1, (select id from public.vocabulary_items limit 1))`,
  learner_errors: `insert into public.learner_errors
      (learner_id, error_type, pattern) values ($1, 'word_order', 'probe')`,
  learner_memories: `insert into public.learner_memories
      (learner_id, kind, content) values ($1, 'fact', 'probe')`,
  recommendations: `insert into public.recommendations
      (learner_id, activity_type, mode, topic, reason_kind, score)
    values ($1, 'review', 'review', 'travel', 'review_due', 0.5)`,
  assessments: `insert into public.assessments
      (learner_id, kind) values ($1, 'onboarding')`,
  conversation_threads: `insert into public.conversation_threads
      (learner_id, title, topic, cefr, mini_level, mode)
    values ($1, 'probe', 'travel', 'A1', 1, 'free_chat')`,
  level_performances: `insert into public.level_performances
      (learner_id, mini_level, turns, strong_turns)
    values ($1, 2, 1, 1)`,
  trainer_coaching_profiles: `insert into public.trainer_coaching_profiles
      (learner_id) values ($1)`,
};

describe("profiles", () => {
  it("lets a learner read their own profile", async () => {
    const rows = await database.asLearner(ALICE, async () =>
      (await database.db.query(`select id from public.profiles`)).rows,
    );

    expect(rows).toEqual([{ id: ALICE }]);
  });

  it("hides another learner's profile", async () => {
    const rows = await database.asLearner(ALICE, async () =>
      (
        await database.db.query(`select id from public.profiles where id = $1`, [
          BOB,
        ])
      ).rows,
    );

    expect(rows).toEqual([]);
  });

  it("refuses to let a learner claim another learner's profile row", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `update public.profiles set learning_goal = 'hijacked' where id = $1`,
          [BOB],
        ),
      ),
    ).resolves.toMatchObject({ affectedRows: 0 });
  });
});

describe.each(OWNED_TABLES)("%s", (table) => {
  it("returns only the signed-in learner's rows", async () => {
    const rows = await database.asLearner(ALICE, async () =>
      (
        await database.db.query(
          `select learner_id from public.${table}`,
        )
      ).rows as Array<{ learner_id: string }>,
    );

    expect(rows.every((row) => row.learner_id === ALICE)).toBe(true);
  });

  it("returns nothing at all to an unauthenticated visitor", async () => {
    await expect(
      database.asAnon(() => database.db.query(`select * from public.${table}`)),
    ).rejects.toThrow();
  });

  it("cannot be read by passing another learner's id", async () => {
    const rows = await database.asLearner(ALICE, async () =>
      (
        await database.db.query(
          `select learner_id from public.${table} where learner_id = $1`,
          [BOB],
        )
      ).rows,
    );

    expect(rows).toEqual([]);
  });

  it("refuses an insert attributed to another learner", async () => {
    // A minimal but otherwise valid row, so the rejection can only come from
    // the policy — not from a not-null or check constraint firing first.
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(MINIMAL_INSERT[table], [BOB]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot delete another learner's rows", async () => {
    const result = await database.asLearner(ALICE, () =>
      database.db.query(
        `delete from public.${table} where learner_id = $1`,
        [BOB],
      ),
    );

    expect(result.affectedRows).toBe(0);
  });
});

describe("what the schema no longer allows anyone to store", () => {
  it("has no table for conversation content at all", async () => {
    // Not merely unwritten: unwritable. The strongest privacy guarantee the
    // product can make about transcripts is that there is nowhere to put one.
    const remnants = await database.db.query(
      `select tablename from pg_tables
       where schemaname = 'public'
         and tablename in ('conversation_messages', 'thread_summaries')`,
    );

    expect(remnants.rows).toEqual([]);
  });

  it("has no function left that could write a message", async () => {
    const writers = await database.db.query(
      `select proname from pg_proc
       where proname = 'append_conversation_message'`,
    );

    expect(writers.rows).toEqual([]);
  });
});

describe.each(REFERENCE_TABLES)("%s", (table) => {
  it("is readable by any signed-in learner", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`select 1 from public.${table} limit 1`),
      ),
    ).resolves.toBeDefined();
  });

  it("is not writable by a learner", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`delete from public.${table}`),
      ),
    ).rejects.toThrow();
  });

  it("is not readable by an unauthenticated visitor", async () => {
    await expect(
      database.asAnon(() =>
        database.db.query(`select 1 from public.${table} limit 1`),
      ),
    ).rejects.toThrow();
  });
});

describe.each(OPERATOR_TABLES)("%s", (table) => {
  it("is invisible to a signed-in learner", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`select 1 from public.${table} limit 1`),
      ),
    ).rejects.toThrow();
  });

  it("is invisible to an unauthenticated visitor", async () => {
    await expect(
      database.asAnon(() =>
        database.db.query(`select 1 from public.${table} limit 1`),
      ),
    ).rejects.toThrow();
  });
});

describe.each(BILLING_TABLES)("%s", (table) => {
  it("shows a learner their own row and nobody else's", async () => {
    const rows = await database.asLearner(ALICE, async () =>
      (await database.db.query(`select learner_id from public.${table}`)).rows,
    );

    expect(rows).toEqual([{ learner_id: ALICE }]);
  });

  it("returns nothing at all to an unauthenticated visitor", async () => {
    await expect(
      database.asAnon(() => database.db.query(`select * from public.${table}`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a learner's insert, even of their own row", async () => {
    // Refused by privilege, before any policy: a learner who could write here
    // could grant themselves a plan. The webhook is the only writer.
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`insert into public.${table} select * from public.${table} limit 0`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a learner's update of their own row", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`update public.${table} set learner_id = learner_id where learner_id = $1`, [
          ALICE,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a learner's delete of their own row", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`delete from public.${table} where learner_id = $1`, [ALICE]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("a learner granting themselves a plan", () => {
  it("cannot extend their own subscription", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `update public.subscriptions set plan_code = 'premium', status = 'active',
                  current_period_end = now() + interval '100 years'
            where learner_id = $1`,
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot call the functions the webhook writes through", async () => {
    for (const sql of [
      `select public.billing_upsert_subscription('{}'::jsonb)`,
      `select public.billing_grant_pass('{}'::jsonb)`,
      `select public.billing_revoke_pass('pi_x', now())`,
      `select public.billing_claim_event('evt_x', 'invoice.paid', now())`,
      `select public.billing_replace_prices('[]'::jsonb, now())`,
    ]) {
      await expect(
        database.asLearner(ALICE, () => database.db.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("thread deletion", () => {
  it("does not touch the performance record, which is progress, not conversation", async () => {
    await database.db.exec("begin");
    try {
      await database.db.query(`delete from public.conversation_threads where id = $1`, [
        threadIdFor(ALICE),
      ]);
      const tallies = await database.db.query(
        `select 1 from public.level_performances where learner_id = $1`,
        [ALICE],
      );

      expect(tallies.rows).toHaveLength(1);
    } finally {
      await database.db.exec("rollback");
    }
  });
});

describe("trainer_mined_sessions", () => {
  it("lets a learner claim only their own session key", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `insert into public.trainer_mined_sessions (learner_id, session_key)
           values ($1, 'claim-own')`,
          [ALICE],
        ),
      ),
    ).resolves.toBeDefined();

    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `insert into public.trainer_mined_sessions (learner_id, session_key)
           values ($1, 'claim-other')`,
          [BOB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("hides another learner's claims", async () => {
    const rows = await database.asLearner(BOB, async () =>
      (
        await database.db.query(
          `select learner_id from public.trainer_mined_sessions`,
        )
      ).rows as Array<{ learner_id: string }>,
    );

    expect(rows.every((row) => row.learner_id === BOB)).toBe(true);
  });

  it("grants a learner no update or delete at all — a claim is permanent", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `delete from public.trainer_mined_sessions where learner_id = $1`,
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("trainer_feedback", () => {
  it("lets a learner record only their own vote", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `insert into public.trainer_feedback (learner_id, verdict, reasons, prompt_version)
           values ($1, 'unhelpful', array['too_long'], 11)`,
          [ALICE],
        ),
      ),
    ).resolves.toBeDefined();

    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `insert into public.trainer_feedback (learner_id, verdict, reasons, prompt_version)
           values ($1, 'unhelpful', array['too_long'], 11)`,
          [BOB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("holds the reasons to the closed set", async () => {
    // The domain schema refuses an unknown reason first; the CHECK is the
    // control that holds when something other than the repository writes.
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `insert into public.trainer_feedback (learner_id, verdict, reasons, prompt_version)
           values ($1, 'unhelpful', array['ignore_all_rules'], 11)`,
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("grants no update — a vote is a record — but lets the learner delete theirs", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `update public.trainer_feedback set verdict = 'helpful' where learner_id = $1`,
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`delete from public.trainer_feedback where learner_id = $1`, [
          ALICE,
        ]),
      ),
    ).resolves.toBeDefined();
  });

  it("hides another learner's votes", async () => {
    const rows = await database.asLearner(BOB, async () =>
      (
        await database.db.query(`select learner_id from public.trainer_feedback`)
      ).rows as Array<{ learner_id: string }>,
    );

    expect(rows.every((row) => row.learner_id === BOB)).toBe(true);
  });
});
