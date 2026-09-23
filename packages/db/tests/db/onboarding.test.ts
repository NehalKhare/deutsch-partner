import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * Onboarding writes a profile and an initial learner state. Both or neither:
 * a profile with no state leaves the dashboard querying a row that is not
 * there, which is why this runs as one database function rather than two
 * round trips.
 */

let database: TestDatabase;

const ARGS = [
  "Hold a conversation on holiday in Berlin",
  "A2",
  ["travel", "food"],
  ["cycling"],
  "text",
  "text",
  "gentle",
];

const CALL = `select public.complete_onboarding($1,$2,$3,$4,$5,$6,$7)`;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedReferenceData();
  // Only the auth user exists; onboarding is what creates the profile.
  await database.db.query(
    `insert into auth.users (id, email) values ($1, 'alice@example.test'),
                                                ($2, 'bob@example.test')`,
    [ALICE, BOB],
  );
});

afterAll(async () => {
  await database?.close();
});

describe("complete_onboarding", () => {
  it("creates the profile and the learner state together", async () => {
    await database.asLearner(ALICE, async () => {
      await database.db.query(CALL, ARGS);

      const profile = await database.db.query(
        `select * from public.profiles where id = $1`,
        [ALICE],
      );
      const state = await database.db.query(
        `select * from public.learner_states where learner_id = $1`,
        [ALICE],
      );

      expect(profile.rows).toHaveLength(1);
      expect(state.rows).toHaveLength(1);
    });
  });

  it("starts the learner at mini-level one regardless of the level they chose", async () => {
    await database.asLearner(ALICE, async () => {
      await database.db.query(CALL, ARGS);

      const state = (
        await database.db.query(
          `select mini_level, effective_cefr, effective_plus
           from public.learner_states where learner_id = $1`,
          [ALICE],
        )
      ).rows[0] as { mini_level: number; effective_cefr: string; effective_plus: boolean };

      // The selection is a preference, not evidence. Until they are assessed
      // they start at the beginning of the path.
      expect(state).toMatchObject({
        mini_level: 1,
        effective_cefr: "A1",
        effective_plus: false,
      });
    });
  });

  it("keeps the learner's chosen level as their stated preference", async () => {
    await database.asLearner(ALICE, async () => {
      await database.db.query(CALL, ARGS);

      const state = (
        await database.db.query(
          `select selected_level, estimated_level from public.learner_states
           where learner_id = $1`,
          [ALICE],
        )
      ).rows[0];

      expect(state).toMatchObject({
        selected_level: "A2",
        estimated_level: null,
      });
    });
  });

  it("marks the profile as onboarded", async () => {
    await database.asLearner(ALICE, async () => {
      await database.db.query(CALL, ARGS);

      const profile = (
        await database.db.query(
          `select onboarded_at from public.profiles where id = $1`,
          [ALICE],
        )
      ).rows[0] as { onboarded_at: Date | null };

      expect(profile.onboarded_at).not.toBeNull();
    });
  });

  it("takes the learner id from the session, never from an argument", async () => {
    // There is no learner id parameter to forge.
    await database.asLearner(ALICE, async () => {
      await database.db.query(CALL, ARGS);

      const owners = await database.db.query(
        `select id from public.profiles`,
      );

      expect(owners.rows).toEqual([{ id: ALICE }]);
    });
  });

  it("can be run twice without creating a second profile", async () => {
    await database.asLearner(ALICE, async () => {
      await database.db.query(CALL, ARGS);
      await database.db.query(CALL, ["Changed my goal", ...ARGS.slice(1)]);

      const profiles = await database.db.query(
        `select learning_goal from public.profiles where id = $1`,
        [ALICE],
      );

      expect(profiles.rows).toEqual([{ learning_goal: "Changed my goal" }]);
    });
  });

  it("does not reset progress when run again", async () => {
    await database.asLearner(ALICE, async () => {
      await database.db.query(CALL, ARGS);
      await database.db.query(
        `update public.learner_states set mini_level = 12, effective_cefr = 'A1'
         where learner_id = $1`,
        [ALICE],
      );
      await database.db.query(CALL, ARGS);

      const state = (
        await database.db.query(
          `select mini_level from public.learner_states where learner_id = $1`,
          [ALICE],
        )
      ).rows[0];

      expect(state).toMatchObject({ mini_level: 12 });
    });
  });

  it("refuses to run without a session", async () => {
    await expect(
      database.asAnon(() => database.db.query(CALL, ARGS)),
    ).rejects.toThrow();
  });

  it("rejects an invalid CEFR selection at the database", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(CALL, [...ARGS.slice(0, 1), "C1", ...ARGS.slice(2)]),
      ),
    ).rejects.toThrow();
  });

  it("leaves no profile behind when the state insert fails", async () => {
    // Atomicity: an invalid level fails the state insert, and the profile must
    // not survive it.
    await database.asLearner(BOB, async () => {
      await expect(
        database.db.query(CALL, [...ARGS.slice(0, 1), "C1", ...ARGS.slice(2)]),
      ).rejects.toThrow();
    });

    const profiles = await database.db.query(
      `select id from public.profiles where id = $1`,
      [BOB],
    );

    expect(profiles.rows).toEqual([]);
  });

  it("cannot be used to create a profile for another learner", async () => {
    await database.asLearner(BOB, async () => {
      await database.db.query(CALL, ARGS);

      const visible = await database.db.query(`select id from public.profiles`);

      expect(visible.rows).toEqual([{ id: BOB }]);
    });
  });
});
