import { describe, expect, it } from "vitest";

import { createPerformanceRepository } from "../src/performance-repository";
import { createFakeSupabase } from "@dp/test-support/fake-supabase";

const LEARNER = "11111111-1111-4111-8111-111111111111";

const tallyRow = {
  learner_id: LEARNER,
  mini_level: 26,
  turns: 5,
  strong_turns: 4,
  // As PostgREST serialises a numeric: a string.
  score: "0.800",
  updated_at: "2026-08-22T10:00:00.000Z",
};

describe("recordTurn", () => {
  it("records through the database function, which is what makes it atomic", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: tallyRow, error: null });

    const result = await createPerformanceRepository(fake.client).recordTurn(26, true);

    expect(fake.rpcCalls[0]).toEqual({
      fn: "record_level_turn",
      args: { p_mini_level: 26, p_strong: true },
    });
    expect(result.ok && result.data.turns).toBe(5);
  });

  it("sends no learner id, so a turn cannot be credited to someone else", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: tallyRow, error: null });

    await createPerformanceRepository(fake.client).recordTurn(26, false);

    expect(Object.keys(fake.rpcCalls[0]?.args ?? {})).toEqual([
      "p_mini_level",
      "p_strong",
    ]);
  });

  it("reads the stored score back as a number, however the wire spelt it", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: tallyRow, error: null });

    const result = await createPerformanceRepository(fake.client).recordTurn(26, true);

    expect(result.ok && result.data.score).toBeCloseTo(0.8, 3);
  });

  it("refuses a mini-level outside the path before querying", async () => {
    const fake = createFakeSupabase({});

    const result = await createPerformanceRepository(fake.client).recordTurn(0, true);

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("treats anything but literal true as a weak turn", async () => {
    // strong is a boolean about an evaluation, and the rpc argument must
    // never be a truthy object that Postgres coerces.
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: { ...tallyRow, strong_turns: 0 }, error: null });

    await createPerformanceRepository(fake.client).recordTurn(
      26,
      "yes" as unknown as boolean,
    );

    expect(fake.rpcCalls[0]?.args).toMatchObject({ p_strong: false });
  });

  it("fails a row that disagrees with the domain rather than passing it on", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: { ...tallyRow, strong_turns: 9 },
      error: null,
    });

    const result = await createPerformanceRepository(fake.client).recordTurn(26, true);

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_data" } });
  });
});

describe("getForLevel", () => {
  it("reads one learner's tally for one level", async () => {
    const fake = createFakeSupabase({ level_performances: { data: [tallyRow] } });

    const result = await createPerformanceRepository(fake.client).getForLevel(
      LEARNER,
      26,
    );

    expect(result.ok && result.data?.strongTurns).toBe(4);
    expect(fake.methodArgs("level_performances", "eq")).toEqual([
      ["learner_id", LEARNER],
      ["mini_level", 26],
    ]);
  });

  it("reads an unspoken-at level as null, not as an error", async () => {
    const fake = createFakeSupabase({ level_performances: { data: [] } });

    const result = await createPerformanceRepository(fake.client).getForLevel(
      LEARNER,
      26,
    );

    expect(result).toEqual({ ok: true, data: null });
  });

  it("refuses a mini-level outside the path before querying", async () => {
    const fake = createFakeSupabase({ level_performances: { data: [] } });

    const result = await createPerformanceRepository(fake.client).getForLevel(
      LEARNER,
      71,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });
});


describe("listForLearner", () => {
  it("reads the learner's whole tally list in path order", async () => {
    const fake = createFakeSupabase({ level_performances: { data: [tallyRow] } });

    const result = await createPerformanceRepository(fake.client).listForLearner(
      LEARNER,
    );

    expect(result.ok && result.data).toHaveLength(1);
    expect(fake.methodArgs("level_performances", "eq")).toEqual([
      ["learner_id", LEARNER],
    ]);
    expect(fake.methodArgs("level_performances", "order")[0]?.[0]).toBe(
      "mini_level",
    );
  });

  it("reads no tallies as an empty list, not an error", async () => {
    const fake = createFakeSupabase({ level_performances: { data: [] } });

    const result = await createPerformanceRepository(fake.client).listForLearner(
      LEARNER,
    );

    expect(result).toEqual({ ok: true, data: [] });
  });
});
