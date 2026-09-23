import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  newLearnerVocabulary,
  recordCorrectUse,
  recordExposure,
  recordIncorrectUse,
} from "../../src/vocabulary-engine";
import { ALICE, createTestDatabase, type TestDatabase } from "@dp/db/testing/harness";

/**
 * The engine against a real engine.
 *
 * The unit tests prove the arithmetic. This proves the results survive the
 * database: mastery_score is numeric(4,3), and two check constraints refuse a
 * record whose counts or status overstate what the learner has shown. A rule
 * the engine believes but Postgres rejects is a runtime failure, not a
 * disagreement about style.
 */

let database: TestDatabase;
let itemId: string;

const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-05-01T08:00:00.000Z");
const at = (days: number) => new Date(START.getTime() + days * DAY);

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedReferenceData();
  await database.seedLearner(ALICE);

  const found = await database.db.query<{ id: string }>(
    `select id from public.vocabulary_items where lemma = 'Zug'`,
  );
  itemId = found.rows[0].id;
});

afterAll(async () => {
  await database?.close();
});

interface StoredRow {
  exposure_count: number;
  correct_count: number;
  incorrect_count: number;
  mastery_score: string;
  confidence: string;
  status: string;
  next_review_at: Date;
}

async function store(record: ReturnType<typeof newLearnerVocabulary>) {
  await database.db.query(
    `insert into public.learner_vocabulary
       (learner_id, vocabulary_item_id, exposure_count, correct_count,
        incorrect_count, mastery_score, confidence, last_seen_at,
        next_review_at, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (learner_id, vocabulary_item_id) do update set
       exposure_count = excluded.exposure_count,
       correct_count = excluded.correct_count,
       incorrect_count = excluded.incorrect_count,
       mastery_score = excluded.mastery_score,
       confidence = excluded.confidence,
       last_seen_at = excluded.last_seen_at,
       next_review_at = excluded.next_review_at,
       status = excluded.status`,
    [
      record.learnerId,
      record.vocabularyItemId,
      record.exposureCount,
      record.correctCount,
      record.incorrectCount,
      record.masteryScore,
      record.confidence,
      record.lastSeenAt,
      record.nextReviewAt,
      record.status,
    ],
  );

  const read = await database.db.query<StoredRow>(
    `select exposure_count, correct_count, incorrect_count, mastery_score,
            confidence, status, next_review_at
     from public.learner_vocabulary
     where learner_id = $1 and vocabulary_item_id = $2`,
    [record.learnerId, record.vocabularyItemId],
  );

  return read.rows[0];
}

describe("a learner's history with one word", () => {
  it("survives every step of a realistic sequence", async () => {
    let record = newLearnerVocabulary(ALICE, itemId);

    const sequence = [
      { apply: recordExposure, day: 0 },
      { apply: recordExposure, day: 0 },
      { apply: recordCorrectUse, day: 1 },
      { apply: recordIncorrectUse, day: 3 },
      { apply: recordCorrectUse, day: 4 },
      { apply: recordCorrectUse, day: 11 },
      { apply: recordCorrectUse, day: 30 },
    ];

    for (const [index, step] of sequence.entries()) {
      record = step.apply(record, at(step.day));
      const stored = await store(record);

      // Read back rather than trusted: numeric(4,3) rounds silently, and a
      // stored score that differs from the one in memory makes the next
      // calculation start from a number the engine never produced.
      expect(Number(stored.mastery_score), `step ${index} mastery drifted`).toBe(
        record.masteryScore,
      );
      expect(Number(stored.confidence), `step ${index} confidence drifted`).toBe(
        record.confidence,
      );
      expect(stored.status).toBe(record.status);
      expect(stored.exposure_count).toBe(record.exposureCount);
    }

    // Familiar, not mastered: the sequence contains one lapse, and a lapse
    // halves the score. Four spaced recalls afterwards claw most of it back
    // but not all — which is the model working, not the model being harsh.
    expect(record.status).toBe("familiar");
    expect(record.masteryScore).toBeGreaterThan(0.6);
    expect(record.masteryScore).toBeLessThan(0.85);
  });

  it("is scheduled where the learner will actually be shown it again", async () => {
    const record = recordCorrectUse(
      recordExposure(newLearnerVocabulary(ALICE, itemId), at(0)),
      at(1),
    );
    const stored = await store(record);

    const due = await database.db.query<{ count: string }>(
      `select count(*)::text as count from public.learner_vocabulary
       where learner_id = $1 and next_review_at <= $2 and status <> 'mastered'`,
      [ALICE, new Date(stored.next_review_at.getTime() + 1000)],
    );

    expect(Number(due.rows[0].count)).toBe(1);
  });
});

describe("the constraints the engine must never violate", () => {
  it("refuses recorded uses that exceed encounters", async () => {
    await expect(
      database.db.query(
        `insert into public.learner_vocabulary
           (learner_id, vocabulary_item_id, exposure_count, correct_count)
         values ($1, $2, 1, 5)
         on conflict (learner_id, vocabulary_item_id) do update
           set exposure_count = 1, correct_count = 5`,
        [ALICE, itemId],
      ),
    ).rejects.toThrow(/learner_vocabulary_uses_within_exposures/);
  });

  it("refuses a status the mastery score does not support", async () => {
    await expect(
      database.db.query(
        `insert into public.learner_vocabulary
           (learner_id, vocabulary_item_id, exposure_count, mastery_score, status)
         values ($1, $2, 3, 0.1, 'mastered')
         on conflict (learner_id, vocabulary_item_id) do update
           set mastery_score = 0.1, status = 'mastered'`,
        [ALICE, itemId],
      ),
    ).rejects.toThrow(/learner_vocabulary_status_matches_mastery/);
  });
});
