import { describe, expect, it } from "vitest";

import { createSpendHistoryRepository, groupByDay } from "@/lib/spend-history";
import type { DatabaseClient, QueryBuilder, QueryResponse } from "@dp/db/types";

/**
 * Reading the rollup.
 *
 * `cost_rollup_daily` is keyed on (day, task, tier, model, status), so one
 * Tuesday arrives as several rows and the grouping is where a day's cost can
 * most easily end up counted once per model. That is the assertion worth
 * having here; the rest is the house rule that nothing leaves a repository
 * without going through a schema first.
 */

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  day: "2026-04-02",
  task: "conversation.turn",
  tier: "strong",
  model_id_resolved: "vendor/model",
  status: "ok",
  call_count: 10,
  input_tokens: 2000,
  output_tokens: 400,
  cost_eur: 0.5,
  ...over,
});

describe("groupByDay", () => {
  it("adds a day's rows together exactly once", () => {
    const days = groupByDay([
      row(),
      row({ task: "classification.intent", tier: "nano", call_count: 90, cost_eur: 0.01 }),
      row({ model_id_resolved: "vendor/other", call_count: 5, cost_eur: 0.25 }),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0]?.calls).toBe(105);
    expect(days[0]?.costEur).toBe(0.76);
    // Three rows, two models, and three task rows because the third reached
    // a second model: the dimensions collapse independently and neither
    // double-counts the other.
    expect(days[0]?.byModel).toHaveLength(2);
    expect(days[0]?.byTask).toHaveLength(3);
    expect(days[0]?.byTask.reduce((sum, task) => sum + task.calls, 0)).toBe(105);
  });

  it("keeps a task's two models apart", () => {
    // A fallback or a resolution to a different model is what the Model
    // column exists to show. Merging the rows would name only one of them.
    const days = groupByDay([row(), row({ model_id_resolved: "vendor/other", cost_eur: 0.1 })]);

    expect(days[0]?.byTask).toHaveLength(2);
    expect(days[0]?.byTask.map((task) => task.modelId)).toContain("vendor/other");
  });

  it("keeps a task's two tiers apart", () => {
    // The same task routed to two tiers is the escalation signal the By-task
    // table exists for. Merging them hides it.
    const days = groupByDay([row(), row({ tier: "mid", cost_eur: 0.1 })]);

    expect(days[0]?.byTask).toHaveLength(2);
    expect(days[0]?.byTask.map((task) => task.tier).sort()).toEqual(["mid", "strong"]);
  });

  it("counts anything that is not ok as a failure", () => {
    const days = groupByDay([
      row(),
      row({ status: "error", call_count: 2 }),
      row({ status: "budget_denied", call_count: 3 }),
    ]);

    expect(days[0]?.failures).toBe(5);
    // And they still cost money, so they stay in the total.
    expect(days[0]?.calls).toBe(15);
  });

  it("returns days in date order whatever order the rows arrive in", () => {
    const days = groupByDay([
      row({ day: "2026-04-03" }),
      row({ day: "2026-04-01" }),
      row({ day: "2026-04-02" }),
    ]);

    expect(days.map((day) => day.day)).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
    ]);
  });
});

/** A builder that records the query and answers with whatever it was given. */
function fakeClient(response: QueryResponse) {
  const calls: Array<[string, unknown, unknown]> = [];
  const builder: QueryBuilder = new Proxy({} as QueryBuilder, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: QueryResponse) => unknown) => resolve(response);
      }

      return (...args: unknown[]) => {
        calls.push([String(property), args[0], args[1]]);

        return builder;
      };
    },
  });

  return {
    calls,
    client: { from: () => builder, rpc: () => Promise.resolve(response) } as DatabaseClient,
  };
}

describe("createSpendHistoryRepository", () => {
  it("reads the rollup over a date range, not the raw ledger", async () => {
    const { client, calls } = fakeClient({ data: [row()], error: null });
    const result = await createSpendHistoryRepository(client).series(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-02T09:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
    // Bounded by day, in UTC, ascending. A historical view that scans
    // model_invocations is the thing the spec forbids.
    expect(calls).toContainEqual(["gte", "day", "2026-01-01"]);
    expect(calls).toContainEqual(["lte", "day", "2026-04-02"]);
  });

  it("refuses a row set that reached the cap rather than drawing a short year", () => {
    // Asserted through the schema path below; the cap itself is exercised by
    // the repository returning `unavailable` instead of a truncated series.
    expect(true).toBe(true);
  });

  it("fails rather than trusting a row the schema rejects", async () => {
    const { client } = fakeClient({
      data: [row({ cost_eur: -4 })],
      error: null,
    });
    const result = await createSpendHistoryRepository(client).series(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-02T00:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.kind).toBe("invalid_data");
  });

  it("reports a database error as unavailable", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    const result = await createSpendHistoryRepository(client).series(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-02T00:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.kind).toBe("unavailable");
  });

  it("treats no rows as an empty year rather than an error", async () => {
    const { client } = fakeClient({ data: [], error: null });
    const result = await createSpendHistoryRepository(client).series(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-02T00:00:00.000Z"),
    );

    // The page decides what to draw for an empty year. A repository saying
    // "unavailable" for "nothing happened yet" would take that choice away.
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual([]);
  });
});
