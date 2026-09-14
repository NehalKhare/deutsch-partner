import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ZodObject } from "zod";

import {
  conversationThreadFromRow,
  conversationThreadRowSchema,
  grammarPatternRowSchema,
  learnerErrorRowSchema,
  learnerMemoryRowSchema,
  learnerStateFromRow,
  learnerStateRowSchema,
  learnerVocabularyFromRow,
  learnerVocabularyRowSchema,
  levelPerformanceFromRow,
  levelPerformanceRowSchema,
  profileFromRow,
  profileRowSchema,
  trainerCoachingProfileFromRow,
  trainerCoachingProfileRowSchema,
  trainerFeedbackFromRow,
  trainerFeedbackRowSchema,
  vocabularyItemFromRow,
  vocabularyItemRowSchema,
} from "@/repositories/rows";
import { ALICE, createTestDatabase, type TestDatabase } from "./harness";

/**
 * The contract between the schema and the mappers.
 *
 * Unit tests feed the mappers hand-written rows, which proves they handle the
 * shape the test author imagined. These feed them rows Postgres actually
 * produced — where numeric comes back as a string, timestamptz as an ISO
 * string, and arrays as arrays — and assert every column a mapper reads is one
 * the migrations really create.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedReferenceData();
  await database.seedLearner(ALICE);
});

afterAll(async () => {
  await database?.close();
});

const CONTRACTS: ReadonlyArray<[string, string, ZodObject]> = [
  ["profiles", "profiles", profileRowSchema],
  ["learner_states", "learner_states", learnerStateRowSchema],
  ["vocabulary_items", "vocabulary_items", vocabularyItemRowSchema],
  ["learner_vocabulary", "learner_vocabulary", learnerVocabularyRowSchema],
  ["grammar_patterns", "grammar_patterns", grammarPatternRowSchema],
  ["learner_errors", "learner_errors", learnerErrorRowSchema],
  ["learner_memories", "learner_memories", learnerMemoryRowSchema],
  ["conversation_threads", "conversation_threads", conversationThreadRowSchema],
  ["level_performances", "level_performances", levelPerformanceRowSchema],
  ["trainer_coaching_profiles", "trainer_coaching_profiles", trainerCoachingProfileRowSchema],
  ["trainer_feedback", "trainer_feedback", trainerFeedbackRowSchema],
];

describe.each(CONTRACTS)("%s", (_label, table, schema) => {
  it("reads only columns the migrations actually create", async () => {
    const actual = new Set(
      (
        (
          await database.db.query(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1`,
            [table],
          )
        ).rows as Array<{ column_name: string }>
      ).map((row) => row.column_name),
    );

    const missing = Object.keys(schema.shape).filter(
      (column) => !actual.has(column),
    );

    expect(missing).toEqual([]);
  });
});

describe("round trip through real Postgres", () => {
  it("decodes a profile written by the repository mapper", async () => {
    const row = (
      await database.db.query(`select * from public.profiles where id = $1`, [
        ALICE,
      ])
    ).rows[0];

    const profile = profileFromRow.parse(row);

    expect(profile).toMatchObject({ id: ALICE, selectedLevel: "A1" });
  });

  it("turns numeric columns into numbers, not strings", async () => {
    const row = (
      await database.db.query(
        `select * from public.learner_states where learner_id = $1`,
        [ALICE],
      )
    ).rows[0];

    const state = learnerStateFromRow.parse(row);

    expect(typeof state.fluency).toBe("number");
    expect(state.updatedAt).toBeInstanceOf(Date);
  });

  it("reassembles the effective level from its two columns", async () => {
    await database.db.query(
      `update public.learner_states
         set effective_cefr = 'A2', effective_plus = true, mini_level = 20
       where learner_id = $1`,
      [ALICE],
    );

    const row = (
      await database.db.query(
        `select * from public.learner_states where learner_id = $1`,
        [ALICE],
      )
    ).rows[0];

    expect(learnerStateFromRow.parse(row).effectiveLevel).toEqual({
      cefr: "A2",
      plus: true,
    });
  });

  it("decodes a vocabulary item including its text array columns", async () => {
    const row = (
      await database.db.query(
        `select * from public.vocabulary_items where lemma = 'Zug'`,
      )
    ).rows[0];

    const item = vocabularyItemFromRow.parse(row);

    expect(item).toMatchObject({ lemma: "Zug", gender: "der", isCoreWord: true });
    expect(Array.isArray(item.collocations)).toBe(true);
  });

  it("decodes learner vocabulary progress with real defaults applied", async () => {
    await database.db.query(
      `insert into public.learner_vocabulary (learner_id, vocabulary_item_id)
       select $1, id from public.vocabulary_items where lemma = 'Zug'`,
      [ALICE],
    );

    const row = (
      await database.db.query(
        `select * from public.learner_vocabulary where learner_id = $1`,
        [ALICE],
      )
    ).rows[0];

    const progress = learnerVocabularyFromRow.parse(row);

    expect(progress).toMatchObject({ status: "new", exposureCount: 0 });
    expect(progress.nextReviewAt).toBeNull();
  });

  it("decodes a coaching profile with the database's own defaults applied", async () => {
    await database.db.query(
      `insert into public.trainer_coaching_profiles (learner_id, focus) values ($1, 'grammar')`,
      [ALICE],
    );

    const row = (
      await database.db.query(
        `select * from public.trainer_coaching_profiles where learner_id = $1`,
        [ALICE],
      )
    ).rows[0];

    const profile = trainerCoachingProfileFromRow.parse(row);

    expect(profile).toMatchObject({
      learnerId: ALICE,
      focus: "grammar",
      explanationDepth: "standard",
      news: true,
      disputedCorrections: 0,
    });
    expect(profile.updatedAt).toBeInstanceOf(Date);
  });

  it("decodes a vote including its text array columns", async () => {
    await database.db.query(
      `insert into public.trainer_feedback
         (learner_id, verdict, reasons, note, tools, prompt_version)
       values ($1, 'unhelpful', array['too_long','unclear'], 'shorter please',
               array['get_review_session'], 11)`,
      [ALICE],
    );

    const row = (
      await database.db.query(
        `select * from public.trainer_feedback where learner_id = $1`,
        [ALICE],
      )
    ).rows[0];

    expect(trainerFeedbackFromRow.parse(row)).toMatchObject({
      learnerId: ALICE,
      verdict: "unhelpful",
      reasons: ["too_long", "unclear"],
      note: "shorter please",
      tools: ["get_review_session"],
      promptVersion: 11,
    });
  });

  it("decodes a thread as the schema stores it", async () => {
    const threadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await database.db.query(
      `insert into public.conversation_threads
         (id, learner_id, title, topic, cefr, mini_level, mode)
       values ($1, $2, 'Round trip', 'travel', 'A2', 20, 'free_chat')`,
      [threadId, ALICE],
    );

    const threadRow = (
      await database.db.query(
        `select * from public.conversation_threads where id = $1`,
        [threadId],
      )
    ).rows[0];

    expect(conversationThreadFromRow.parse(threadRow)).toMatchObject({
      id: threadId,
      mode: "free_chat",
      miniLevel: 20,
    });
  });

  it("decodes a tally the database function wrote, generated score included", async () => {
    await database.db.query(
      `select set_config('request.jwt.claim.sub', $1, false)`,
      [ALICE],
    );
    for (const strong of [true, true, true, false]) {
      await database.db.query(`select public.record_level_turn(20, $1)`, [strong]);
    }

    const row = (
      await database.db.query(
        `select * from public.level_performances
         where learner_id = $1 and mini_level = 20`,
        [ALICE],
      )
    ).rows[0];

    const performance = levelPerformanceFromRow.parse(row);

    expect(performance).toMatchObject({ turns: 4, strongTurns: 3 });
    expect(performance.score).toBeCloseTo(0.75, 3);
    expect(performance.updatedAt).toBeInstanceOf(Date);
  });
});
