import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * The per-level tally against a real engine.
 *
 * This table is the long-term memory conversations leave behind, and the
 * mastery gate reads it, so its rules have to hold under the conditions the
 * unit tests cannot create: two turns landing at once, a session that is not
 * there, a caller who is not the learner.
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

interface TallyRow {
  turns: number;
  strong_turns: number;
  score: string;
}

async function recordAs(
  learnerId: string,
  miniLevel: number,
  strong: boolean,
): Promise<void> {
  await database.db.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [learnerId],
  );
  await database.db.query(`select public.record_level_turn($1, $2)`, [
    miniLevel,
    strong,
  ]);
}

async function tallyFor(learnerId: string, miniLevel: number): Promise<TallyRow> {
  return (
    await database.db.query<TallyRow>(
      `select turns, strong_turns, score::text as score
       from public.level_performances
       where learner_id = $1 and mini_level = $2`,
      [learnerId, miniLevel],
    )
  ).rows[0];
}

async function reset(): Promise<void> {
  await database.db.query(`delete from public.level_performances`);
}

describe("recording a turn", () => {
  it("counts turns and strong turns separately", async () => {
    await reset();
    await recordAs(ALICE, 1, true);
    await recordAs(ALICE, 1, false);
    await recordAs(ALICE, 1, true);

    expect(await tallyFor(ALICE, 1)).toMatchObject({
      turns: 3,
      strong_turns: 2,
    });
  });

  it("stores the score the tally implies, computed by the database itself", async () => {
    await reset();
    await recordAs(ALICE, 2, true);
    await recordAs(ALICE, 2, true);
    await recordAs(ALICE, 2, true);
    await recordAs(ALICE, 2, false);

    expect(Number((await tallyFor(ALICE, 2)).score)).toBeCloseTo(0.75, 3);
  });

  it("belongs to the caller, with no way to say otherwise", async () => {
    // The function takes no learner id at all: the tally is stamped from the
    // verified session, so a caller cannot pad someone else's record.
    await reset();
    await recordAs(BOB, 3, true);

    const owners = (
      await database.db.query<{ learner_id: string }>(
        `select learner_id from public.level_performances`,
      )
    ).rows;

    expect(owners).toEqual([{ learner_id: BOB }]);
  });

  it("keeps each level's tally separate", async () => {
    await reset();
    await recordAs(ALICE, 1, true);
    await recordAs(ALICE, 2, false);

    expect((await tallyFor(ALICE, 1)).strong_turns).toBe(1);
    expect((await tallyFor(ALICE, 2)).strong_turns).toBe(0);
  });

  it("fails closed with no session", async () => {
    await database.db.query(`select set_config('request.jwt.claim.sub', '', false)`);

    await expect(
      database.db.query(`select public.record_level_turn(1, true)`),
    ).rejects.toThrow(/authenticated session/);
  });

  it("refuses a mini-level outside the path", async () => {
    await database.db.query(
      `select set_config('request.jwt.claim.sub', $1, false)`,
      [ALICE],
    );

    await expect(
      database.db.query(`select public.record_level_turn(71, true)`),
    ).rejects.toThrow(/mini_level_check/);
  });
});

describe("what the table itself refuses", () => {
  it("rejects more strong turns than turns", async () => {
    await expect(
      database.db.query(
        `insert into public.level_performances (learner_id, mini_level, turns, strong_turns)
         values ($1, 10, 1, 2)`,
        [ALICE],
      ),
    ).rejects.toThrow(/strong_within_turns/);
  });

  it("rejects a tally for a learner who does not exist", async () => {
    await expect(
      database.db.query(
        `insert into public.level_performances (learner_id, mini_level, turns, strong_turns)
         values ('99999999-9999-4999-8999-999999999999', 1, 1, 1)`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("refuses to store the score directly, because it is derived", async () => {
    await expect(
      database.db.query(
        `insert into public.level_performances (learner_id, mini_level, turns, strong_turns, score)
         values ($1, 11, 5, 5, 0.1)`,
        [ALICE],
      ),
    ).rejects.toThrow(/non-DEFAULT value/i);
  });
});

describe("who can read a tally", () => {
  it("hides one learner's performance from another", async () => {
    await reset();
    await recordAs(ALICE, 5, true);

    const visible = await database.asLearner(BOB, async () =>
      (
        await database.db.query<{ count: string }>(
          `select count(*)::text as count from public.level_performances`,
        )
      ).rows[0],
    );

    expect(Number(visible.count)).toBe(0);
  });

  it("does not let a visitor with no session reach the table at all", async () => {
    await expect(
      database.asAnon(() =>
        database.db.query(`select count(*) from public.level_performances`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("when the learner is deleted", () => {
  it("takes their tallies with them", async () => {
    const GONE = "33333333-3333-4333-8333-333333333333";
    await database.seedLearner(GONE);
    await recordAs(GONE, 1, true);

    await database.db.query(`delete from public.profiles where id = $1`, [GONE]);

    const remaining = (
      await database.db.query<{ count: string }>(
        `select count(*)::text as count from public.level_performances where learner_id = $1`,
        [GONE],
      )
    ).rows[0];

    expect(Number(remaining.count)).toBe(0);
  });
});
