import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EXPORTED_TABLES, createLearnerAdminRepository } from "../../src/learner-admin-repository";
import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";
import type { DatabaseClient } from "../../src/types";

/**
 * The operator's learner-support functions, against a real engine.
 *
 * What only Postgres can confirm: that a read or a write for one learner can
 * never reach another's rows (every function takes the learner id and every
 * statement filters on it), that an operator's level move satisfies the same
 * constraints a learner's own move does, that the export really holds every
 * learner-owned table — checked against the foreign keys, so a table added
 * next month without an export entry fails here — and that none of it is
 * callable from a learner's session.
 */

let database: TestDatabase;

const CAROL = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedReferenceData();
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec(`delete from public.profiles; delete from auth.users;`);
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

async function call<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await database.db.query<{ result: T }>(`select ${sql} as result`, params);
  return result.rows[0].result;
}

async function refusal(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function thread(learner: string, updatedAt: string) {
  await database.db.query(
    `insert into public.conversation_threads
       (learner_id, title, topic, cefr, mini_level, mode, created_at, updated_at)
     values ($1, 'Im Café', 'food', 'A1', 1, 'free_chat', $2, $2)`,
    [learner, updatedAt],
  );
}

async function error(learner: string, pattern = "ich habe gegangen"): Promise<string> {
  const result = await database.db.query<{ id: string }>(
    `insert into public.learner_errors (learner_id, error_type, pattern, occurrence_count, example_utterances)
     values ($1, 'perfekt', $2, 4, array['Ich habe gegangen nach Hause.'])
     returning id`,
    [learner, pattern],
  );
  return result.rows[0].id;
}

async function memory(learner: string): Promise<string> {
  const result = await database.db.query<{ id: string }>(
    `insert into public.learner_memories (learner_id, kind, content, salience)
     values ($1, 'interest', 'Plays the cello', 0.8) returning id`,
    [learner],
  );
  return result.rows[0].id;
}

interface ListPage {
  rows: Array<{
    id: string;
    miniLevel: number;
    effectiveCefr: string;
    onboardedAt: string | null;
    lastActiveAt: string | null;
    openErrors: number;
    createdAt: string;
  }>;
  totals: { learners: number; onboarded: number };
}

async function list(args: Record<string, unknown> = {}): Promise<ListPage> {
  return call<ListPage>(
    `public.ops_learner_list(
       p_limit => $1, p_before_created => $2, p_before_id => $3,
       p_cefr => $4, p_onboarded => $5, p_inactive_days => $6, p_now => $7)`,
    [
      args.limit ?? 50,
      args.beforeCreated ?? null,
      args.beforeId ?? null,
      args.cefr ?? null,
      args.onboarded ?? null,
      args.inactiveDays ?? null,
      args.now ?? "2026-09-23T15:00:00Z",
    ],
  );
}

describe("ops_learner_list", () => {
  beforeEach(async () => {
    await database.db.query(`update public.profiles set created_at = '2026-09-01T00:00:00Z' where id = $1`, [ALICE]);
    await database.db.query(`update public.profiles set created_at = '2026-09-10T00:00:00Z', onboarded_at = now() where id = $1`, [BOB]);
  });

  it("lists learners newest first with where they stand", async () => {
    await error(ALICE);
    const page = await list();

    expect(page.rows.map((row) => row.id)).toEqual([BOB, ALICE]);
    expect(page.rows[1]).toMatchObject({ miniLevel: 1, effectiveCefr: "A1", openErrors: 1 });
    expect(page.totals).toEqual({ learners: 2, onboarded: 1 });
  });

  it("pages by creation time and id, never by offset", async () => {
    const first = await list({ limit: 1 });
    // One more than asked, so the caller knows there is another page.
    expect(first.rows.map((row) => row.id)).toEqual([BOB, ALICE]);

    const second = await list({ limit: 1, beforeCreated: first.rows[0]?.createdAt, beforeId: BOB });
    expect(second.rows.map((row) => row.id)).toEqual([ALICE]);
  });

  it("filters by level, by onboarding and by inactivity", async () => {
    await database.db.query(
      `update public.learner_states
          set mini_level = 20, effective_cefr = 'A2', selected_level = 'A2' where learner_id = $1`,
      [BOB],
    );
    await thread(ALICE, "2026-09-22T10:00:00Z");

    expect((await list({ cefr: "A2" })).rows.map((row) => row.id)).toEqual([BOB]);
    expect((await list({ onboarded: false })).rows.map((row) => row.id)).toEqual([ALICE]);
    // Bob has never been active, so his clock starts when he signed up.
    expect((await list({ inactiveDays: 7 })).rows.map((row) => row.id)).toEqual([BOB]);
  });

  it("reports the last activity it can see", async () => {
    await thread(ALICE, "2026-09-22T10:00:00Z");

    const alice = (await list()).rows.find((row) => row.id === ALICE);
    expect(alice?.lastActiveAt).toContain("2026-09-22");
  });
});

interface Detail {
  profile: Record<string, unknown>;
  state: Record<string, unknown> | null;
  levels: unknown[];
  vocabulary: { byStatus: Record<string, number>; due: number; rows: unknown[] };
  errors: Array<{ id: string; example_utterances: string[] }>;
  memories: Array<{ id: string; content: string }>;
  assessments: unknown[];
  recommendations: unknown[];
  threads: unknown[];
  coaching: unknown;
  feedback: unknown[];
  minedSessions: number;
}

describe("ops_learner_detail", () => {
  it("is null for somebody who has no profile", async () => {
    expect(await call(`public.ops_learner_detail($1)`, [CAROL])).toBeNull();
  });

  it("holds everything stored about one learner, and nothing about another", async () => {
    await error(ALICE);
    await error(BOB, "der Frau");
    await memory(ALICE);
    await thread(ALICE, "2026-09-22T10:00:00Z");
    await database.db.query(
      `insert into public.level_performances (learner_id, mini_level, turns, strong_turns) values ($1, 1, 10, 7)`,
      [ALICE],
    );

    const detail = await call<Detail>(`public.ops_learner_detail($1)`, [ALICE]);

    expect(detail.profile).toMatchObject({ id: ALICE });
    expect(detail.state).toMatchObject({ learner_id: ALICE, mini_level: 1 });
    expect(detail.errors).toHaveLength(1);
    expect(detail.errors[0]?.example_utterances).toEqual(["Ich habe gegangen nach Hause."]);
    expect(detail.memories.map((row) => row.content)).toEqual(["Plays the cello"]);
    expect(detail.levels).toHaveLength(1);
    expect(detail.threads).toHaveLength(1);
    expect(detail.coaching).toBeNull();
    expect(detail.vocabulary).toEqual({ byStatus: {}, due: 0, rows: [] });
    expect(detail.minedSessions).toBe(0);
  });
});

describe("ops_learner_export", () => {
  it("covers every table that holds a learner's rows", async () => {
    // Every table with a foreign key to profiles is learner-owned data. The
    // export is the answer to "give me everything you hold about me", so a
    // table missing from it is a table silently withheld.
    const owned = await database.db.query<{ table_name: string }>(
      `select distinct c.conrelid::regclass::text as table_name
         from pg_constraint c
        where c.contype = 'f'
          and c.confrelid = 'public.profiles'::regclass`,
    );
    const exported = await call<Record<string, unknown>>(`public.ops_learner_export($1)`, [ALICE]);

    const tables = owned.rows.map((row) => row.table_name.replace(/^public\./, "")).sort();
    expect(tables.length).toBeGreaterThan(5);
    for (const table of [...tables, "profiles"]) {
      expect(exported, table).toHaveProperty(table);
    }
  });

  it("holds the learner's rows and not another learner's", async () => {
    await error(ALICE);
    await error(BOB, "der Frau");

    const exported = await call<{ learner_errors: Array<{ learner_id: string }>; profiles: unknown[] }>(
      `public.ops_learner_export($1)`,
      [ALICE],
    );

    expect(exported.learner_errors.map((row) => row.learner_id)).toEqual([ALICE]);
    expect(exported.profiles).toHaveLength(1);
  });

  it("is null for somebody with no profile", async () => {
    expect(await call(`public.ops_learner_export($1)`, [CAROL])).toBeNull();
  });

  it("is what the repository expects, table for table", async () => {
    // EXPORTED_TABLES is what the repository's schema requires of the export.
    // Held to the foreign keys too, so neither can gain a table the other lacks.
    const owned = await database.db.query<{ table_name: string }>(
      `select distinct c.conrelid::regclass::text as table_name
         from pg_constraint c
        where c.contype = 'f'
          and c.confrelid = 'public.profiles'::regclass`,
    );
    const tables = owned.rows.map((row) => row.table_name.replace(/^public\./, ""));

    expect([...EXPORTED_TABLES].sort()).toEqual([...tables, "profiles"].sort());
  });

  it("carries the learner's billing rows, and not another learner's", async () => {
    // What they bought and the consent they gave are theirs to see (spec S10).
    for (const [learner, tag] of [[ALICE, "Alice"], [BOB, "Bob0"]] as const) {
      await database.db.query(
        `insert into public.billing_customers (learner_id, stripe_customer_id) values ($1, $2)`,
        [learner, `cus_${tag}`],
      );
      await database.db.query(
        `insert into public.billing_checkouts
           (learner_id, offer_key, kind, terms_version, early_start_consent_at)
         values ($1, 'dp_pass_plus', 'order', '2026-09-25', now())`,
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
         values ($1, 'plus', now(), now() + interval '180 days', $2, 4499, 'eur')`,
        [learner, `cs_test_${tag}`],
      );
    }

    const exported = await call<Record<string, Array<{ learner_id: string }>>>(
      `public.ops_learner_export($1)`,
      [ALICE],
    );

    for (const table of ["billing_customers", "billing_checkouts", "subscriptions", "plan_passes"]) {
      expect(exported[table]?.map((row) => row.learner_id), table).toEqual([ALICE]);
    }
    expect(exported.billing_customers?.[0]).toMatchObject({ stripe_customer_id: "cus_Alice" });
  });
});

interface Change<T = Record<string, unknown>> {
  before: T;
  after: T;
}

describe("moving a learner's level", () => {
  it("derives the level from the mini-level and clears the estimate, as a learner's own move does", async () => {
    await database.db.query(`update public.learner_states set estimated_level = 'A1', effective_plus = true where learner_id = $1`, [ALICE]);

    const change = await call<Change>(`public.ops_set_learner_mini_level($1, 40)`, [ALICE]);

    expect(change.before).toMatchObject({ mini_level: 1, effective_cefr: "A1" });
    expect(change.after).toMatchObject({
      mini_level: 40,
      effective_cefr: "B1",
      selected_level: "B1",
      effective_plus: false,
      estimated_level: null,
      furthest_mini_level: 40,
      skipped_mini_levels: [],
    });
  });

  it("refuses a mini-level off the path", async () => {
    expect(await refusal(() => call(`public.ops_set_learner_mini_level($1, 71)`, [ALICE]))).toBe("22023");
  });

  it("is null for an unknown learner", async () => {
    expect(await call(`public.ops_set_learner_mini_level($1, 5)`, [CAROL])).toBeNull();
  });

  it("clears the skipped levels", async () => {
    await database.db.query(`update public.learner_states set mini_level = 5, effective_cefr = 'A1', skipped_mini_levels = '{2,3}' where learner_id = $1`, [ALICE]);

    const change = await call<Change>(`public.ops_clear_skipped_levels($1)`, [ALICE]);

    expect(change.before).toMatchObject({ skipped_mini_levels: [2, 3] });
    expect(change.after).toMatchObject({ skipped_mini_levels: [] });
  });
});

describe("resetting one level's tally", () => {
  it("removes that learner's row for that level only", async () => {
    for (const learner of [ALICE, BOB]) {
      await database.db.query(
        `insert into public.level_performances (learner_id, mini_level, turns, strong_turns) values ($1, 3, 10, 2)`,
        [learner],
      );
    }

    const removed = await call<{ turns: number }>(`public.ops_reset_level_performance($1, 3)`, [ALICE]);
    expect(removed).toMatchObject({ turns: 10 });

    const left = await database.db.query(`select learner_id from public.level_performances`);
    expect(left.rows).toEqual([{ learner_id: BOB }]);
  });
});

describe("marking an error resolved", () => {
  it("changes the flag on that learner's error", async () => {
    const id = await error(ALICE);

    const change = await call<Change<{ resolved: boolean }>>(
      `public.ops_set_learner_error_resolved($1, $2, true)`,
      [ALICE, id],
    );

    expect([change.before.resolved, change.after.resolved]).toEqual([false, true]);
  });

  it("cannot reach another learner's error through the wrong learner id", async () => {
    const bobs = await error(BOB);

    expect(await call(`public.ops_set_learner_error_resolved($1, $2, true)`, [ALICE, bobs])).toBeNull();
    const row = await database.db.query<{ resolved: boolean }>(`select resolved from public.learner_errors where id = $1`, [bobs]);
    expect(row.rows[0]?.resolved).toBe(false);
  });
});

describe("the coaching and threshold settings", () => {
  it("changes the mastery threshold, within the three the product offers", async () => {
    const change = await call<Change<{ mastery_threshold: number }>>(`public.ops_set_mastery_threshold($1, 50)`, [ALICE]);
    expect([change.before.mastery_threshold, change.after.mastery_threshold]).toEqual([80, 50]);

    expect(await refusal(() => call(`public.ops_set_mastery_threshold($1, 60)`, [ALICE]))).toBe("23514");
  });

  it("resets the disputed-corrections count, and is null without a coaching profile", async () => {
    expect(await call(`public.ops_reset_disputed_corrections($1)`, [ALICE])).toBeNull();

    await database.db.query(`insert into public.trainer_coaching_profiles (learner_id, disputed_corrections) values ($1, 6)`, [ALICE]);
    const change = await call<Change<{ disputed_corrections: number }>>(`public.ops_reset_disputed_corrections($1)`, [ALICE]);

    expect([change.before.disputed_corrections, change.after.disputed_corrections]).toEqual([6, 0]);
  });
});

describe("deleting a memory", () => {
  it("deletes that learner's memory and returns it", async () => {
    const id = await memory(ALICE);

    expect(await call(`public.ops_delete_learner_memory($1, $2)`, [ALICE, id])).toMatchObject({ content: "Plays the cello" });
    const left = await database.db.query(`select id from public.learner_memories`);
    expect(left.rows).toEqual([]);
  });

  it("cannot reach another learner's memory", async () => {
    const bobs = await memory(BOB);

    expect(await call(`public.ops_delete_learner_memory($1, $2)`, [ALICE, bobs])).toBeNull();
    const left = await database.db.query(`select id from public.learner_memories`);
    expect(left.rows).toHaveLength(1);
  });
});

describe("from a learner's session", () => {
  const MEMORY = "44444444-4444-4444-8444-444444444444";

  it.each([
    [`public.ops_learner_list()`],
    [`public.ops_learner_detail('${BOB}')`],
    [`public.ops_learner_export('${BOB}')`],
    [`public.ops_set_learner_mini_level('${BOB}', 5)`],
    [`public.ops_clear_skipped_levels('${BOB}')`],
    [`public.ops_reset_level_performance('${BOB}', 1)`],
    [`public.ops_set_learner_error_resolved('${BOB}', '${MEMORY}', true)`],
    [`public.ops_set_mastery_threshold('${BOB}', 33)`],
    [`public.ops_reset_disputed_corrections('${BOB}')`],
    [`public.ops_delete_learner_memory('${BOB}', '${MEMORY}')`],
  ])("%s is refused", async (sql) => {
    const code = await refusal(() => database.asLearner(ALICE, () => database.db.query(`select ${sql}`)));
    expect(code).toBe("42501");
  });
});

describe("the repository, against what Postgres really returns", () => {
  // A DatabaseClient whose rpc runs the real function with named arguments,
  // so every schema in the repository meets real rows: numerics as strings,
  // timestamps as text, arrays as arrays.
  const client = () =>
    ({
      async rpc(fn: string, args: Record<string, unknown> = {}) {
        const names = Object.keys(args);
        const call = names.map((name, index) => `${name} => $${index + 1}`).join(", ");
        try {
          const result = await database.db.query<{ result: unknown }>(
            `select public.${fn}(${call}) as result`,
            names.map((name) => args[name]),
          );
          return { data: result.rows[0]?.result ?? null, error: null };
        } catch (caught) {
          return { data: null, error: { code: (caught as { code?: string }).code ?? null, message: "failed" } };
        }
      },
      from: () => {
        throw new Error("not used here");
      },
    }) as unknown as DatabaseClient;

  it("parses a full detail through the learner's own row mappers", async () => {
    await error(ALICE);
    await memory(ALICE);
    await thread(ALICE, "2026-09-22T10:00:00Z");
    await database.db.query(
      `insert into public.level_performances (learner_id, mini_level, turns, strong_turns) values ($1, 1, 10, 7)`,
      [ALICE],
    );
    await database.db.query(`insert into public.trainer_coaching_profiles (learner_id) values ($1)`, [ALICE]);
    await database.db.query(
      `insert into public.trainer_feedback (learner_id, verdict, prompt_version) values ($1, 'helpful', 3)`,
      [ALICE],
    );
    await database.db.query(
      `insert into public.learner_vocabulary (learner_id, vocabulary_item_id, exposure_count, mastery_score, status)
       select $1, id, 3, 0.2, 'weak' from public.vocabulary_items limit 1`,
      [ALICE],
    );
    await database.db.query(
      `insert into public.assessments (learner_id, kind, score, passed) values ($1, 'onboarding', 0.5, true)`,
      [ALICE],
    );
    await database.db.query(
      `insert into public.recommendations (learner_id, activity_type, mode, topic, reason_kind, score)
       values ($1, 'review', 'review', 'food', 'review_due', 0.9)`,
      [ALICE],
    );

    const result = await createLearnerAdminRepository(client()).detail(ALICE);

    expect(result.ok, JSON.stringify(!result.ok && (result.error.cause as { issues?: unknown })?.issues)).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.profile.id).toBe(ALICE);
    expect(result.data.state?.miniLevel).toBe(1);
    expect(result.data.errors[0]?.exampleUtterances).toHaveLength(1);
    expect(result.data.memories[0]?.content).toBe("Plays the cello");
    expect(result.data.levels[0]?.score).toBeCloseTo(0.7);
    expect(result.data.vocabulary.rows[0]?.status).toBe("weak");
    expect(result.data.vocabulary.byStatus.weak).toBe(1);
    expect(result.data.assessments[0]?.passed).toBe(true);
    expect(result.data.recommendations[0]?.score).toBeCloseTo(0.9);
    expect(result.data.coaching?.disputedCorrections).toBe(0);
    expect(result.data.feedback).toHaveLength(1);
    expect(result.data.createdAt).toBeInstanceOf(Date);
  });

  it("parses the list, the export and every correction", async () => {
    const repo = createLearnerAdminRepository(client());

    const page = await repo.list({});
    expect(page.ok && page.data.rows.map((row) => row.id).sort()).toEqual([ALICE, BOB].sort());

    const exported = await repo.export(ALICE);
    expect(exported.ok && exported.data).toHaveProperty("learner_states");

    const moved = await repo.setMiniLevel(ALICE, 16);
    expect(moved.ok && moved.data).toEqual({
      before: { miniLevel: 1, cefr: "A1", skipped: [] },
      after: { miniLevel: 16, cefr: "A2", skipped: [] },
    });

    const id = await error(ALICE);
    const resolved = await repo.setErrorResolved(ALICE, id, true);
    expect(resolved.ok && resolved.data).toEqual({ before: false, after: true, errorType: "perfekt" });

    const threshold = await repo.setMasteryThreshold(ALICE, 33);
    expect(threshold.ok && threshold.data).toEqual({ before: 80, after: 33 });

    const removed = await repo.deleteMemory(ALICE, await memory(ALICE));
    expect(removed.ok && removed.data).toEqual({ kind: "interest" });

    expect(await repo.resetDisputedCorrections(ALICE)).toEqual({ ok: true, data: null });
  });

  it("maps a refused value to a safe kind", async () => {
    const result = await createLearnerAdminRepository(client()).setMiniLevel(ALICE, 71);

    // Refused before the database: the domain knows the path has seventy levels.
    expect(result.ok).toBe(false);
  });
});
