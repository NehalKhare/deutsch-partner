import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MAX_STORED_EXAMPLES,
  errorObservationSchema,
  type LearnerError,
} from "../../domain/learner-error";
import { aggregateObservation } from "../../learning/error-engine";
import { ALICE, BOB, createTestDatabase, type TestDatabase } from "./harness";

/**
 * The aggregation rule lives twice: as a pure function the application can
 * reason with, and in SQL where it has to be atomic. These tests replay the
 * same observations through both and require them to agree, so the
 * duplication is checked rather than trusted.
 */

let database: TestDatabase;

const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-07-01T09:00:00.000Z");
const at = (days: number) => new Date(START.getTime() + days * DAY);

interface StoredError {
  id: string;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved: boolean;
  example_utterances: string[];
  pattern: string;
}

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedReferenceData();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

afterAll(async () => {
  await database?.close();
});

/** Records one observation as the given learner, through the ordinary path. */
async function record(
  learnerId: string,
  input: { pattern: string; utterance?: string | null; observedAt: Date; errorType?: string },
): Promise<void> {
  await database.db.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [learnerId],
  );
  await database.db.query(
    `select public.record_learner_error($1, $2, $3, $4)`,
    [
      input.errorType ?? "word_order",
      input.pattern,
      input.utterance ?? null,
      input.observedAt,
    ],
  );
}

async function stored(learnerId: string): Promise<StoredError[]> {
  const result = await database.db.query<StoredError>(
    `select id, pattern, occurrence_count, first_seen_at, last_seen_at,
            resolved, example_utterances
     from public.learner_errors where learner_id = $1 order by pattern`,
    [learnerId],
  );
  return result.rows;
}

async function reset(): Promise<void> {
  await database.db.query(`delete from public.learner_errors`);
}

describe("repeated observations", () => {
  it("aggregate into one record with a rising count", async () => {
    await reset();
    for (let day = 0; day < 7; day += 1) {
      await record(ALICE, {
        pattern: "verb not in final position in a weil-clause",
        utterance: `Satz Nummer ${day}.`,
        observedAt: at(day),
      });
    }

    const rows = await stored(ALICE);

    expect(rows).toHaveLength(1);
    expect(rows[0].occurrence_count).toBe(7);
    expect(rows[0].first_seen_at).toEqual(at(0));
    expect(rows[0].last_seen_at).toEqual(at(6));
  });

  it("aggregate across the wording a model happens to use", async () => {
    // Same normalisation as the application, enforced at the boundary that
    // matters. Without it each turn would open its own row.
    await reset();
    for (const pattern of [
      "Wrong gender on Tisch",
      "  wrong   gender on Tisch  ",
      "wrong gender on Tisch.",
    ]) {
      await record(ALICE, { pattern, errorType: "gender", observedAt: at(0) });
    }

    const rows = await stored(ALICE);

    expect(rows).toHaveLength(1);
    expect(rows[0].pattern).toBe("wrong gender on tisch");
    expect(rows[0].occurrence_count).toBe(3);
  });

  it("keep genuinely different mistakes apart", async () => {
    await reset();
    await record(ALICE, { pattern: "wrong gender on Tisch", errorType: "gender", observedAt: at(0) });
    await record(ALICE, { pattern: "wrong gender on Tür", errorType: "gender", observedAt: at(0) });
    await record(ALICE, { pattern: "wrong gender on Tisch", errorType: "article", observedAt: at(0) });

    expect(await stored(ALICE)).toHaveLength(3);
  });

  it("keep the newest examples once the cap is reached", async () => {
    await reset();
    for (let turn = 0; turn < MAX_STORED_EXAMPLES + 5; turn += 1) {
      await record(ALICE, {
        pattern: "wrong case after mit",
        errorType: "case_dative",
        utterance: `Satz Nummer ${turn}.`,
        observedAt: at(turn),
      });
    }

    const [row] = await stored(ALICE);

    expect(row.example_utterances).toHaveLength(MAX_STORED_EXAMPLES);
    expect(row.example_utterances[0]).toBe(`Satz Nummer ${MAX_STORED_EXAMPLES + 4}.`);
  });

  it("never store the same sentence twice", async () => {
    await reset();
    for (let turn = 0; turn < 3; turn += 1) {
      await record(ALICE, {
        pattern: "wrong case after mit",
        errorType: "case_dative",
        utterance: "Mit den Zug.",
        observedAt: at(turn),
      });
    }

    const [row] = await stored(ALICE);

    expect(row.occurrence_count).toBe(3);
    expect(row.example_utterances).toEqual(["Mit den Zug."]);
  });

  it("accept an observation with no example sentence", async () => {
    await reset();
    await record(ALICE, { pattern: "word order", observedAt: at(0) });
    await record(ALICE, { pattern: "word order", utterance: "Weil ich bin müde.", observedAt: at(1) });
    await record(ALICE, { pattern: "word order", observedAt: at(2) });

    const [row] = await stored(ALICE);

    expect(row.occurrence_count).toBe(3);
    expect(row.example_utterances).toEqual(["Weil ich bin müde."]);
  });

  it("widen the window when one arrives out of order", async () => {
    await reset();
    await record(ALICE, { pattern: "word order", observedAt: at(5) });
    await record(ALICE, { pattern: "word order", observedAt: at(1) });

    const [row] = await stored(ALICE);

    expect(row.first_seen_at).toEqual(at(1));
    expect(row.last_seen_at).toEqual(at(5));
  });
});

describe("the SQL rule and the TypeScript rule", () => {
  it("agree over a long mixed sequence", async () => {
    await reset();

    const utterances = [
      "Weil ich bin müde.",
      "Weil ich habe keine Zeit.",
      "Weil ich bin müde.",
      null,
      "Weil er ist krank.",
    ];

    let expected: LearnerError | null = null;

    for (let turn = 0; turn < 25; turn += 1) {
      const utterance = utterances[turn % utterances.length];
      const observedAt = at(turn % 2 === 0 ? turn : turn - 0.5);

      await record(ALICE, {
        pattern: "  Verb NOT in final position.  ",
        utterance,
        observedAt,
      });

      expected = aggregateObservation(
        expected,
        errorObservationSchema.parse({
          learnerId: ALICE,
          errorType: "word_order",
          pattern: "  Verb NOT in final position.  ",
          utterance: utterance ?? undefined,
          observedAt,
        }),
        "00000000-0000-4000-8000-000000000000",
      );
    }

    const [row] = await stored(ALICE);

    expect(row.pattern).toBe(expected!.pattern);
    expect(row.occurrence_count).toBe(expected!.occurrenceCount);
    expect(row.first_seen_at).toEqual(expected!.firstSeenAt);
    expect(row.last_seen_at).toEqual(expected!.lastSeenAt);
    expect(row.example_utterances).toEqual(expected!.exampleUtterances);
    expect(row.resolved).toBe(expected!.resolved);
  });
});

describe("resolving", () => {
  it("marks a corrected mistake resolved", async () => {
    await reset();
    await record(ALICE, { pattern: "word order", observedAt: at(0) });

    await database.db.query(
      `update public.learner_errors set resolved = true where learner_id = $1`,
      [ALICE],
    );

    expect((await stored(ALICE))[0].resolved).toBe(true);
  });

  it("reopens it the moment the learner makes it again", async () => {
    await reset();
    await record(ALICE, { pattern: "word order", observedAt: at(0) });
    await database.db.query(
      `update public.learner_errors set resolved = true where learner_id = $1`,
      [ALICE],
    );

    await record(ALICE, { pattern: "word order", observedAt: at(10) });

    const [row] = await stored(ALICE);

    expect(row.resolved).toBe(false);
    expect(row.occurrence_count).toBe(2);
  });
});

describe("the function refuses what it cannot own", () => {
  it("fails closed with no session", async () => {
    await database.db.query(`select set_config('request.jwt.claim.sub', '', false)`);

    await expect(
      database.db.query(`select public.record_learner_error('word_order', 'x')`),
    ).rejects.toThrow(/authenticated session/);
  });

  it("refuses a pattern that is empty once normalised", async () => {
    await expect(
      record(ALICE, { pattern: "  ...  ", observedAt: at(0) }),
    ).rejects.toThrow(/pattern/);
  });

  it("refuses an error type outside the taxonomy", async () => {
    await expect(
      record(ALICE, { pattern: "something", errorType: "vibes", observedAt: at(0) }),
    ).rejects.toThrow(/learner_errors_error_type_check/);
  });

  it("writes to the caller's own row, never to another learner's", async () => {
    await reset();
    await record(ALICE, { pattern: "word order", observedAt: at(0) });
    await record(BOB, { pattern: "word order", observedAt: at(0) });

    expect(await stored(ALICE)).toHaveLength(1);
    expect(await stored(BOB)).toHaveLength(1);
    expect((await stored(ALICE))[0].id).not.toBe((await stored(BOB))[0].id);
  });
});

describe("the query the review engine runs", () => {
  it("is served by the partial index on unresolved errors", async () => {
    const plan = await database.db.query<{ "QUERY PLAN": string }>(
      `explain select * from public.learner_errors
       where learner_id = $1 and not resolved
       order by occurrence_count desc limit 5`,
      [ALICE],
    );

    expect(plan.rows.map((row) => row["QUERY PLAN"]).join(" ")).toMatch(
      /learner_errors_unresolved_idx/,
    );
  });
});
