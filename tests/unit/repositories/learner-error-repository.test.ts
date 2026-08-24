import { describe, expect, it } from "vitest";

import { createLearnerErrorRepository } from "@/repositories/learner-error-repository";
import { createFakeSupabase } from "../../support/fake-supabase";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const ERROR_ID = "33333333-3333-4333-8333-333333333333";
const OBSERVED_AT = new Date("2026-06-01T10:00:00.000Z");

const errorRow = {
  id: ERROR_ID,
  learner_id: LEARNER,
  error_type: "word_order",
  pattern: "verb not in final position in a weil-clause",
  occurrence_count: 7,
  first_seen_at: "2026-05-01T10:00:00.000Z",
  last_seen_at: "2026-06-01T10:00:00.000Z",
  resolved: false,
  example_utterances: ["Weil ich bin müde."],
};

function observation(overrides: Record<string, unknown> = {}) {
  return {
    learnerId: LEARNER,
    errorType: "word_order",
    pattern: "  Verb NOT in final position in a weil-clause.  ",
    utterance: "Ich bleibe zu Hause, weil ich bin müde.",
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe("recording an observation", () => {
  it("counts through the database function, not a read and a write", async () => {
    // Two turns can report the same mistake at once. Reading the count and
    // writing it back would lose one of them.
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: ERROR_ID, error: null });

    const result = await createLearnerErrorRepository(fake.client).record(
      observation(),
    );

    expect(result).toEqual({ ok: true, data: ERROR_ID });
    expect(fake.rpcCalls[0]?.fn).toBe("record_learner_error");
  });

  it("normalises the pattern before it becomes an aggregation key", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: ERROR_ID, error: null });

    await createLearnerErrorRepository(fake.client).record(observation());

    expect(fake.rpcCalls[0]?.args).toMatchObject({
      p_error_type: "word_order",
      p_pattern: "verb not in final position in a weil-clause",
      p_observed_at: OBSERVED_AT.toISOString(),
    });
  });

  it("passes no learner id, so the call cannot be aimed at anyone else", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: ERROR_ID, error: null });

    await createLearnerErrorRepository(fake.client).record(observation());

    expect(Object.keys(fake.rpcCalls[0]?.args ?? {})).not.toContain(
      "p_learner_id",
    );
  });

  it("sends an absent utterance as null rather than omitting it", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: ERROR_ID, error: null });

    await createLearnerErrorRepository(fake.client).record(
      observation({ utterance: undefined }),
    );

    expect(fake.rpcCalls[0]?.args).toMatchObject({ p_utterance: null });
  });

  it("rejects an unknown error type before reaching the database", async () => {
    const fake = createFakeSupabase({});

    const result = await createLearnerErrorRepository(fake.client).record(
      observation({ errorType: "vibes" }),
    );

    expect(result.ok).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects a pattern that is empty once normalised", async () => {
    const fake = createFakeSupabase({});

    const result = await createLearnerErrorRepository(fake.client).record(
      observation({ pattern: "   ...  " }),
    );

    expect(result.ok).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("reports a database failure without leaking its message", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: null,
      error: { code: "42501", message: 'permission denied for table "learner_errors"' },
    });

    const result = await createLearnerErrorRepository(fake.client).record(
      observation(),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).not.toMatch(/permission denied/);
  });
});

describe("reading a learner's mistakes", () => {
  it("asks only for the ones still open, worst first", async () => {
    const fake = createFakeSupabase({ learner_errors: { data: [errorRow] } });

    const result = await createLearnerErrorRepository(fake.client).listUnresolved(
      LEARNER,
      10,
    );

    expect(result.ok && result.data[0]?.occurrenceCount).toBe(7);
    expect(fake.methodArgs("learner_errors", "eq")).toEqual([
      ["learner_id", LEARNER],
      ["resolved", false],
    ]);
    expect(fake.methodArgs("learner_errors", "order")).toEqual([
      ["occurrence_count", { ascending: false }],
    ]);
  });

  it("turns the stored row into the domain shape", async () => {
    const fake = createFakeSupabase({ learner_errors: { data: [errorRow] } });

    const result = await createLearnerErrorRepository(fake.client).listForLearner(
      LEARNER,
      10,
    );

    expect(result.ok && result.data[0]).toMatchObject({
      learnerId: LEARNER,
      errorType: "word_order",
      firstSeenAt: new Date("2026-05-01T10:00:00.000Z"),
    });
  });

  it("refuses a row that contradicts the domain rules", async () => {
    // last_seen_at before first_seen_at would fail the check constraint, so a
    // row like this means something wrote around the database.
    const fake = createFakeSupabase({
      learner_errors: {
        data: [{ ...errorRow, last_seen_at: "2026-01-01T00:00:00.000Z" }],
      },
    });

    const result = await createLearnerErrorRepository(fake.client).listForLearner(
      LEARNER,
      10,
    );

    expect(result.ok).toBe(false);
  });
});

describe("resolving a mistake", () => {
  it("filters on the id alone and lets RLS decide ownership", async () => {
    const fake = createFakeSupabase({
      learner_errors: { data: { ...errorRow, resolved: true } },
    });

    const result = await createLearnerErrorRepository(fake.client).markResolved(
      ERROR_ID,
    );

    expect(result.ok && result.data.resolved).toBe(true);
    expect(fake.methodArgs("learner_errors", "eq")).toEqual([["id", ERROR_ID]]);
    expect(fake.methodArgs("learner_errors", "update")).toEqual([
      [{ resolved: true }],
    ]);
  });
});
