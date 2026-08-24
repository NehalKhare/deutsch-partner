import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALICE, BOB, createTestDatabase, type TestDatabase } from "./harness";

/**
 * Thread ownership against a real engine.
 *
 * A thread is a place to practise — a title, a topic, the level it was opened
 * at — and nothing more: what is said in one lives in the learner's browser
 * and is never written down. What remains database rules is who can see a
 * thread, who can rename one, and who can delete one, and none of that can be
 * checked by mocking a query builder.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedReferenceData();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

afterAll(async () => {
  await database?.close();
});

/** Starts a thread as the given learner, through the ordinary path. */
async function startThread(
  learnerId: string,
  title = "Am Bahnhof",
): Promise<string> {
  await database.db.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [learnerId],
  );
  const result = await database.db.query<{ id: string }>(
    `select (public.start_conversation_thread($1, 'travel', 'roleplay')).id`,
    [title],
  );
  return result.rows[0].id;
}

async function reset(): Promise<void> {
  await database.db.query(`delete from public.conversation_threads`);
}

describe("starting a thread", () => {
  it("takes the level from the learner's record, not from the caller", async () => {
    await reset();
    await database.db.query(
      `update public.learner_states set effective_cefr = 'A2', mini_level = 22
       where learner_id = $1`,
      [ALICE],
    );

    const threadId = await startThread(ALICE);

    const [row] = (
      await database.db.query<{ cefr: string; mini_level: number; learner_id: string }>(
        `select cefr, mini_level, learner_id from public.conversation_threads where id = $1`,
        [threadId],
      )
    ).rows;

    expect(row).toEqual({ cefr: "A2", mini_level: 22, learner_id: ALICE });
  });

  it("belongs to the caller, whatever they ask for", async () => {
    await reset();
    const threadId = await startThread(BOB);

    const [row] = (
      await database.db.query<{ learner_id: string }>(
        `select learner_id from public.conversation_threads where id = $1`,
        [threadId],
      )
    ).rows;

    expect(row.learner_id).toBe(BOB);
  });

  it("fails closed with no session", async () => {
    await database.db.query(`select set_config('request.jwt.claim.sub', '', false)`);

    await expect(
      database.db.query(
        `select public.start_conversation_thread('x', 'travel', 'roleplay')`,
      ),
    ).rejects.toThrow(/authenticated session/);
  });

  it("refuses a learner who has not finished onboarding", async () => {
    const stranger = "44444444-4444-4444-8444-444444444444";
    await database.db.query(
      `select set_config('request.jwt.claim.sub', $1, false)`,
      [stranger],
    );

    await expect(
      database.db.query(
        `select public.start_conversation_thread('x', 'travel', 'roleplay')`,
      ),
    ).rejects.toThrow(/onboarding/);
  });
});

describe("a learner only sees their own threads", () => {
  it("hides another learner's thread from a list", async () => {
    await reset();
    await startThread(ALICE, "Alice am Bahnhof");
    await startThread(BOB, "Bob im Café");

    const visible = await database.asLearner(ALICE, async () =>
      (
        await database.db.query<{ title: string }>(
          `select title from public.conversation_threads`,
        )
      ).rows,
    );

    expect(visible).toEqual([{ title: "Alice am Bahnhof" }]);
  });

  it("does not let a visitor with no session reach the table at all", async () => {
    // Stronger than seeing zero rows: anon has no grant on the table, so the
    // request is refused before Row Level Security is even consulted.
    await reset();
    await startThread(ALICE);

    await expect(
      database.asAnon(() =>
        database.db.query(`select count(*) from public.conversation_threads`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("deleting a thread", () => {
  it("leaves the learner's progress untouched", async () => {
    // A thread is a place to practise, not the record of having practised.
    // The record is the per-level tally, and deleting a chat must not be a
    // way to undo a fortnight of learning by accident.
    await reset();
    const threadId = await startThread(ALICE);
    await database.db.query(
      `insert into public.level_performances (learner_id, mini_level, turns, strong_turns)
       values ($1, 1, 4, 3)
       on conflict (learner_id, mini_level) do nothing`,
      [ALICE],
    );

    await database.db.query(`delete from public.conversation_threads where id = $1`, [
      threadId,
    ]);

    const tally = (
      await database.db.query<{ turns: number }>(
        `select turns from public.level_performances
         where learner_id = $1 and mini_level = 1`,
        [ALICE],
      )
    ).rows[0];

    expect(tally.turns).toBe(4);
  });

  it("cannot be done to somebody else's thread", async () => {
    await reset();
    const aliceThread = await startThread(ALICE);

    const deleted = await database.asLearner(BOB, async () =>
      (
        await database.db.query<{ id: string }>(
          `delete from public.conversation_threads where id = $1 returning id`,
          [aliceThread],
        )
      ).rows,
    );

    expect(deleted).toEqual([]);

    const survived = (
      await database.db.query<{ count: string }>(
        `select count(*)::text as count from public.conversation_threads where id = $1`,
        [aliceThread],
      )
    ).rows[0];

    expect(Number(survived.count)).toBe(1);
  });
});

describe("renaming a thread", () => {
  it("cannot hand it to another learner", async () => {
    // The update policy carries a WITH CHECK as well as a USING clause.
    // Without it, a learner could reassign learner_id and give away a row.
    await reset();
    const threadId = await startThread(ALICE);

    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(
          `update public.conversation_threads set learner_id = $1 where id = $2`,
          [BOB, threadId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot be done to somebody else's thread", async () => {
    await reset();
    const aliceThread = await startThread(ALICE);

    const updated = await database.asLearner(BOB, async () =>
      (
        await database.db.query<{ id: string }>(
          `update public.conversation_threads set title = 'Meins' where id = $1 returning id`,
          [aliceThread],
        )
      ).rows,
    );

    expect(updated).toEqual([]);
  });
});
