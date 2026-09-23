import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";

/**
 * The learner feedback aggregate, against a real engine.
 *
 * What only Postgres can confirm: the function sums across learners when
 * called with the operator's privileges, a learner's role cannot execute it,
 * the window and the note cap hold, and a table with nothing in it yields a
 * document rather than nulls.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec("delete from public.trainer_feedback");
});

interface Summary {
  totals: { votes: number; helpful: number; unhelpful: number; learners: number; noted: number };
  byReason: { reason: string; count: number }[];
  byPromptVersion: { promptVersion: number; votes: number; unhelpful: number }[];
  byTool: { tool: string; votes: number; unhelpful: number }[];
  recentNotes: { note: string; verdict: string; reasons: string[] }[];
  window: { days: number };
}

async function summary(days = 30, notes = 20): Promise<Summary> {
  const result = await database.db.query<{ summary: Summary }>(
    `select public.learner_feedback_summary(p_days => $1, p_notes => $2) as summary`,
    [days, notes],
  );
  return result.rows[0].summary;
}

async function vote(
  learner: string,
  verdict: "helpful" | "unhelpful",
  over: { reasons?: string[]; note?: string; tools?: string[]; version?: number; ago?: string } = {},
) {
  await database.db.query(
    `insert into public.trainer_feedback
       (learner_id, verdict, reasons, note, tools, prompt_version, created_at)
     values ($1, $2, $3::text[], $4, $5::text[], $6, now() - $7::interval)`,
    [
      learner,
      verdict,
      over.reasons ?? [],
      over.note ?? null,
      over.tools ?? [],
      over.version ?? 11,
      over.ago ?? "1 hour",
    ],
  );
}

describe("learner_feedback_summary", () => {
  it("sums across learners, by verdict, reason, prompt version and tool", async () => {
    await vote(ALICE, "unhelpful", { reasons: ["too_long", "unclear"], tools: ["get_review_session"], note: "shorter" });
    await vote(ALICE, "helpful", { tools: ["get_review_session"] });
    await vote(BOB, "unhelpful", { reasons: ["too_long"], version: 10, tools: ["fetch_simple_german_news"] });

    const result = await summary();

    expect(result.totals).toEqual({ votes: 3, helpful: 1, unhelpful: 2, learners: 2, noted: 1 });
    expect(result.byReason).toEqual([
      { reason: "too_long", count: 2 },
      { reason: "unclear", count: 1 },
    ]);
    expect(result.byPromptVersion).toEqual([
      expect.objectContaining({ promptVersion: 11, votes: 2, unhelpful: 1 }),
      expect.objectContaining({ promptVersion: 10, votes: 1, unhelpful: 1 }),
    ]);
    expect(result.byTool[0]).toMatchObject({ tool: "get_review_session", votes: 2, unhelpful: 1 });
    expect(result.recentNotes).toEqual([
      { note: "shorter", verdict: "unhelpful", reasons: ["too_long", "unclear"], createdAt: expect.any(String) },
    ]);
  });

  it("names no learner anywhere in the document", async () => {
    await vote(ALICE, "unhelpful", { reasons: ["too_hard"], note: "hard" });

    const text = JSON.stringify(await summary());

    expect(text).not.toContain(ALICE);
    expect(text).not.toContain("learner_id");
  });

  it("honours the window", async () => {
    await vote(ALICE, "unhelpful", { reasons: ["too_long"], ago: "40 days" });
    await vote(ALICE, "helpful", { ago: "1 day" });

    const month = await summary(30);
    const season = await summary(90);

    expect(month.totals.votes).toBe(1);
    expect(season.totals.votes).toBe(2);
    expect(month.window.days).toBe(30);
  });

  it("caps the notes and returns the newest first", async () => {
    for (let index = 0; index < 5; index += 1) {
      await vote(ALICE, "helpful", { note: `note ${index}`, ago: `${5 - index} minutes` });
    }

    const result = await summary(30, 2);

    expect(result.recentNotes.map((entry) => entry.note)).toEqual(["note 4", "note 3"]);
  });

  it("returns a whole document, with empty lists, when nothing was voted", async () => {
    const result = await summary();

    expect(result.totals).toEqual({ votes: 0, helpful: 0, unhelpful: 0, learners: 0, noted: 0 });
    expect(result.byReason).toEqual([]);
    expect(result.byPromptVersion).toEqual([]);
    expect(result.byTool).toEqual([]);
    expect(result.recentNotes).toEqual([]);
  });

  it("cannot be executed by a signed-in learner", async () => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`select public.learner_feedback_summary(30, 20)`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot be executed anonymously", async () => {
    await expect(
      database.asAnon(() => database.db.query(`select public.learner_feedback_summary(30, 20)`)),
    ).rejects.toThrow();
  });
});
