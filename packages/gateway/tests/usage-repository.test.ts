import { describe, expect, it } from "vitest";

import { createUsageAccounting } from "../src/repositories/usage-repository";
import { createFakeSupabase } from "@dp/test-support/fake-supabase";

/**
 * The budget read, from the gateway's side of the wire.
 *
 * What the snapshot sends decides which limit a learner is held to: their own
 * override, their plan's row, or the default (billing-and-plans-spec.md S9).
 * The SQL that resolves the order is tested on a real database in packages/db;
 * this file pins the arguments that reach it.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");
const HASH = "0123456789abcdef0123456789abcdef";

describe("reading the budget counters", () => {
  it("names the learner's plan, so the plan's euro bound is the one applied", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [] });

    await createUsageAccounting(fake.client).snapshot({ userIdHash: HASH, now: NOW, plan: "plus" });

    expect(fake.rpcCalls).toEqual([
      {
        fn: "budget_snapshot",
        args: { p_user_id_hash: HASH, p_now: NOW.toISOString(), p_plan: "plus" },
      },
    ]);
  });

  it("sends exactly what it sent before plans existed when there is no plan", async () => {
    // A call with no plan resolves as it always did, down to the wire.
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: [] });

    await createUsageAccounting(fake.client).snapshot({ userIdHash: HASH, now: NOW });

    expect(fake.rpcCalls[0]?.args).toEqual({ p_user_id_hash: HASH, p_now: NOW.toISOString() });
  });

  it("reads the rows back as numbers", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({
      data: [
        {
          scope: "per_user_monthly",
          scope_key: "plan:plus",
          limit_eur: "4.0000",
          spent_eur: "1.2500",
          warn_pct: "0.70",
          degrade_pct: "0.90",
        },
      ],
    });

    const snapshots = await createUsageAccounting(fake.client).snapshot({
      userIdHash: HASH,
      now: NOW,
      plan: "plus",
    });

    expect(snapshots).toEqual([
      {
        scope: "per_user_monthly",
        scopeKey: "plan:plus",
        limitEur: 4,
        spentEur: 1.25,
        warnPct: 0.7,
        degradePct: 0.9,
      },
    ]);
  });

  it("fails closed with null, never an empty list, when the read is refused", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ error: { code: "PGRST202", message: "no such function" } });

    await expect(
      createUsageAccounting(fake.client).snapshot({ userIdHash: HASH, now: NOW, plan: "free" }),
    ).resolves.toBeNull();
  });
});
