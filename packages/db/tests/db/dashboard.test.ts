import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * The learner's summary function against a real engine.
 *
 * The dashboard is the one screen a learner uses to decide whether the
 * product is working, and it had no database test at all — which is how it
 * shipped a mistake filter that hid a working account's entire history.
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

async function summaryFor(learnerId: string): Promise<Record<string, unknown>> {
  await database.db.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [learnerId],
  );
  const result = await database.db.query<{ learner_dashboard: unknown }>(
    `select public.learner_dashboard(now())`,
  );
  return result.rows[0].learner_dashboard as Record<string, unknown>;
}

describe("level scores", () => {
  it("carries every level the learner has been evaluated at", async () => {
    await database.db.query(
      `select set_config('request.jwt.claim.sub', $1, false)`,
      [ALICE],
    );
    for (const [level, strong] of [[1, true], [1, false], [2, true]] as const) {
      await database.db.query(`select public.record_level_turn($1, $2)`, [
        level,
        strong,
      ]);
    }

    const summary = await summaryFor(ALICE);
    const scores = summary.levelScores as Array<Record<string, unknown>>;

    expect(scores).toHaveLength(2);
    expect(scores[0]).toMatchObject({ miniLevel: 1, turns: 2, strongTurns: 1 });
    expect(Number(scores[0]?.score)).toBeCloseTo(0.5, 3);
  });

  it("shows nobody else's tallies", async () => {
    const summary = await summaryFor(BOB);

    expect(summary.levelScores).toEqual([]);
  });
});

describe("recurring mistakes", () => {
  it("shows a mistake made once, counted honestly", async () => {
    // The old threshold hid everything under three occurrences, which on a
    // young account is everything.
    await database.db.query(
      `insert into public.learner_errors (learner_id, error_type, pattern)
       values ($1, 'case_dative', 'uses the accusative after mit')`,
      [ALICE],
    );

    const summary = await summaryFor(ALICE);
    const mistakes = summary.recurringMistakes as Array<Record<string, unknown>>;

    expect(mistakes.length).toBeGreaterThan(0);
    expect(mistakes[0]).toMatchObject({
      pattern: "uses the accusative after mit",
      occurrences: 1,
    });
  });
});
