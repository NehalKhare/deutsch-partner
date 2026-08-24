import { describe, expect, it } from "vitest";

import type { LearnerError } from "@/domain/learner-error";
import {
  SIGNAL_CANDIDATE_POOL,
  getLearningSignals,
} from "@/learning/error-signals";
import { repositoryError, type RepositoryResult } from "@/repositories/errors";
import type { LearnerErrorRepository } from "@/repositories/learner-error-repository";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-01T09:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function error(
  pattern: string,
  occurrenceCount: number,
  daysAgo: number,
): LearnerError {
  return {
    id: `33333333-3333-4333-8333-${pattern.length}${"0".repeat(11)}`,
    learnerId: LEARNER,
    errorType: "word_order",
    pattern,
    occurrenceCount,
    firstSeenAt: ago(daysAgo + 30),
    lastSeenAt: ago(daysAgo),
    resolved: false,
    exampleUtterances: ["Weil ich bin müde."],
  };
}

function stub(open: RepositoryResult<LearnerError[]>) {
  const limits: number[] = [];
  const repository = {
    async listUnresolved(_learnerId: string, limit: number) {
      limits.push(limit);
      return open;
    },
  } as unknown as LearnerErrorRepository;

  return { repository, limits };
}

describe("reading a learner's signals", () => {
  it("returns the recurring, unresolved patterns", async () => {
    const { repository } = stub({ ok: true, data: [error("word order", 7, 1)] });

    const result = await getLearningSignals(repository, { learnerId: LEARNER, now: NOW });

    expect(result.ok && result.data).toHaveLength(1);
    expect(result.ok && result.data[0]?.occurrenceCount).toBe(7);
  });

  it("asks only for the ones still open", async () => {
    const { repository, limits } = stub({ ok: true, data: [] });

    await getLearningSignals(repository, { learnerId: LEARNER, now: NOW });

    expect(limits).toEqual([SIGNAL_CANDIDATE_POOL]);
  });

  it("considers more patterns than it returns, so recency can reorder them", async () => {
    // The database orders by how often a mistake happened. Fetching only the
    // handful it will show would let a stale frequent pattern crowd out a
    // fresh one before the ranking ever sees it.
    const { repository, limits } = stub({ ok: true, data: [] });

    await getLearningSignals(repository, { learnerId: LEARNER, now: NOW, limit: 3 });

    expect(limits[0]).toBeGreaterThan(3);
  });

  it("lets a fresh pattern beat a stale but more frequent one", async () => {
    const { repository } = stub({
      ok: true,
      data: [error("stale", 20, 90), error("fresh", 5, 0)],
    });

    const result = await getLearningSignals(repository, { learnerId: LEARNER, now: NOW });

    expect(result.ok && result.data[0]?.pattern).toBe("fresh");
  });

  it("drops a one-off even though the database returned it", async () => {
    const { repository } = stub({ ok: true, data: [error("once", 1, 0)] });

    const result = await getLearningSignals(repository, { learnerId: LEARNER, now: NOW });

    expect(result.ok && result.data).toEqual([]);
  });

  it("rejects a limit larger than a prompt should carry", async () => {
    const { repository, limits } = stub({ ok: true, data: [] });

    const result = await getLearningSignals(repository, {
      learnerId: LEARNER,
      now: NOW,
      limit: 500,
    });

    expect(result.ok).toBe(false);
    expect(limits).toEqual([]);
  });

  it("passes a failed read straight through", async () => {
    const failure = { ok: false, error: repositoryError("unavailable") } as const;
    const { repository } = stub(failure);

    expect(await getLearningSignals(repository, { learnerId: LEARNER, now: NOW })).toEqual(
      failure,
    );
  });
});
