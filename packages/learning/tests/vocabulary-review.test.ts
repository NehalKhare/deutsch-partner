import { describe, expect, it } from "vitest";

import type { LearnerVocabulary, VocabularyItem } from "@dp/domain/vocabulary";
import { getDueVocabulary } from "../src/vocabulary-review";
import { repositoryError, type RepositoryResult } from "@dp/db/errors";
import type { VocabularyRepository } from "@dp/db/vocabulary-repository";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-04-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function itemId(n: number): string {
  return `2222222${n}-2222-4222-8222-222222222222`;
}

function item(n: number): VocabularyItem {
  return {
    id: itemId(n),
    lemma: `Wort${n}`,
    word: `das Wort${n}`,
    partOfSpeech: "noun",
    gender: "das",
    plural: null,
    englishTranslation: `word ${n}`,
    germanDefinition: "Eine Einheit der Sprache.",
    example: `Das ist ein Wort${n}.`,
    collocations: [],
    commonMistakes: [],
    cefr: "A1",
    miniLevel: 4,
    topic: "language",
    frequencyBand: 3,
    isCoreWord: true,
  };
}

function progress(n: number, overdueDays: number, mastery: number): LearnerVocabulary {
  return {
    learnerId: LEARNER,
    vocabularyItemId: itemId(n),
    exposureCount: 6,
    correctCount: 3,
    incorrectCount: 1,
    masteryScore: mastery,
    confidence: 0.4,
    lastSeenAt: new Date(NOW.getTime() - overdueDays * DAY),
    nextReviewAt: new Date(NOW.getTime() - overdueDays * DAY),
    status: "learning",
  };
}

interface Stub {
  readonly repository: VocabularyRepository;
  readonly idsRequested: string[][];
  readonly dueLimits: number[];
}

function stubRepository(
  due: RepositoryResult<LearnerVocabulary[]>,
  items: RepositoryResult<VocabularyItem[]>,
): Stub {
  const idsRequested: string[][] = [];
  const dueLimits: number[] = [];

  const repository = {
    async findByLemmas() {
      throw new Error("not used");
    },
    async findByIds(ids: readonly string[]) {
      idsRequested.push([...ids]);
      return items;
    },
    async listForLearner() {
      throw new Error("not used");
    },
    async listDue(_learnerId: string, _now: Date, limit: number) {
      dueLimits.push(limit);
      return due;
    },
    async upsertLearnerVocabulary() {
      throw new Error("not used");
    },
  } as unknown as VocabularyRepository;

  return { repository, idsRequested, dueLimits };
}

describe("building a review session", () => {
  it("pairs each due word with the word itself", async () => {
    const stub = stubRepository(
      { ok: true, data: [progress(1, 3, 0.5)] },
      { ok: true, data: [item(1)] },
    );

    const result = await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data[0]).toMatchObject({
      item: { lemma: "Wort1" },
      overdueDays: 3,
    });
  });

  it("asks for exactly the words it is going to show", async () => {
    const stub = stubRepository(
      { ok: true, data: [progress(1, 1, 0.5), progress(2, 2, 0.5)] },
      { ok: true, data: [item(1), item(2)] },
    );

    await getDueVocabulary(stub.repository, { learnerId: LEARNER, now: NOW });

    expect(stub.idsRequested).toEqual([[itemId(1), itemId(2)]]);
  });

  it("puts the word most in need of attention first", async () => {
    const stub = stubRepository(
      {
        ok: true,
        data: [progress(1, 1, 0.9), progress(2, 12, 0.5), progress(3, 2, 0.2)],
      },
      { ok: true, data: [item(1), item(2), item(3)] },
    );

    const result = await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
    });

    expect(result.ok && result.data.map((entry) => entry.item.lemma)).toEqual([
      "Wort2",
      "Wort3",
      "Wort1",
    ]);
  });

  it("does not query for words when nothing is due", async () => {
    const stub = stubRepository({ ok: true, data: [] }, { ok: true, data: [] });

    const result = await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, data: [] });
    expect(stub.idsRequested).toEqual([]);
  });

  it("caps a session rather than returning an unbounded list", async () => {
    const stub = stubRepository({ ok: true, data: [] }, { ok: true, data: [] });

    await getDueVocabulary(stub.repository, { learnerId: LEARNER, now: NOW });

    expect(stub.dueLimits[0]).toBeGreaterThan(0);
    expect(stub.dueLimits[0]).toBeLessThanOrEqual(50);
  });

  it("honours a smaller requested limit", async () => {
    const stub = stubRepository({ ok: true, data: [] }, { ok: true, data: [] });

    await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
      limit: 5,
    });

    expect(stub.dueLimits).toEqual([5]);
  });

  it("rejects a limit that is not a sensible session size", async () => {
    const stub = stubRepository({ ok: true, data: [] }, { ok: true, data: [] });

    const result = await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
      limit: 0,
    });

    expect(result.ok).toBe(false);
    expect(stub.dueLimits).toEqual([]);
  });

  it("passes a failed progress read straight through", async () => {
    const failure = { ok: false, error: repositoryError("unavailable") } as const;
    const stub = stubRepository(failure, { ok: true, data: [] });

    const result = await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
    });

    expect(result).toEqual(failure);
  });

  it("fails rather than showing a session with words missing", async () => {
    // A progress row whose word cannot be loaded is drift between two tables.
    // Dropping it silently would show a short session and hide the cause.
    const stub = stubRepository(
      { ok: true, data: [progress(1, 1, 0.5), progress(2, 1, 0.5)] },
      { ok: true, data: [item(1)] },
    );

    const result = await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("invalid_data");
  });

  it("reports a word that was never scheduled as due today", async () => {
    const unscheduled = { ...progress(1, 0, 0.3), nextReviewAt: null };
    const stub = stubRepository(
      { ok: true, data: [unscheduled] },
      { ok: true, data: [item(1)] },
    );

    const result = await getDueVocabulary(stub.repository, {
      learnerId: LEARNER,
      now: NOW,
    });

    expect(result.ok && result.data[0]?.overdueDays).toBe(0);
  });
});
