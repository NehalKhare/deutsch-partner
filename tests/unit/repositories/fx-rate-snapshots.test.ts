import { describe, expect, it } from "vitest";

import { createFxRateSnapshots } from "@/repositories/usage-repository";
import { createFakeSupabase } from "../../support/fake-supabase";

/**
 * The write side of the euro rate.
 *
 * Small surface, and every part of it is load-bearing: the pair it stores
 * under is what the reader filters on, the date is what decides whether a
 * priced row is flagged as carried forward, and the conflict target is what
 * makes a job that runs twice a day idempotent rather than a duplicate.
 */

const SNAPSHOT = { eurPerUsd: 0.8, rateDate: "2026-08-24", source: "ecb" };

describe("storing a day's rate", () => {
  it("stores it as the pair the reader looks for", async () => {
    const fake = createFakeSupabase({ fx_rates: {} });

    await createFxRateSnapshots(fake.client).save(SNAPSHOT);

    const [[payload]] = fake.methodArgs("fx_rates", "upsert");
    expect(payload).toMatchObject({
      base_currency: "USD",
      quote_currency: "EUR",
      rate: 0.8,
      rate_date: "2026-08-24",
      source: "ecb",
    });
  });

  it("replaces the day rather than adding a second row for it", async () => {
    // The unique constraint is on the pair and the date, and the job is meant
    // to be safe to re-run — before the source publishes and again after.
    const fake = createFakeSupabase({ fx_rates: {} });

    await createFxRateSnapshots(fake.client).save(SNAPSHOT);

    const [[, options]] = fake.methodArgs("fx_rates", "upsert");
    expect(options).toEqual({ onConflict: "base_currency,quote_currency,rate_date" });
  });

  it("stamps when it was fetched, not when the source published", async () => {
    const fake = createFakeSupabase({ fx_rates: {} });

    await createFxRateSnapshots(fake.client).save(SNAPSHOT);

    const [[payload]] = fake.methodArgs("fx_rates", "upsert");
    const stamped = (payload as { fetched_at: string }).fetched_at;
    expect(Number.isNaN(Date.parse(stamped))).toBe(false);
  });

  it("reports a refusal instead of throwing", async () => {
    const fake = createFakeSupabase({
      fx_rates: { error: { code: "42501", message: "denied" } },
    });

    await expect(createFxRateSnapshots(fake.client).save(SNAPSHOT)).resolves.toEqual({
      ok: false,
      detail: "42501",
    });
  });

  it("says it stored the rate when the database accepted it", async () => {
    const fake = createFakeSupabase({ fx_rates: {} });

    await expect(createFxRateSnapshots(fake.client).save(SNAPSHOT)).resolves.toEqual({
      ok: true,
    });
  });
});

describe("when the source was last asked", () => {
  it("reads the newest fetch, not the newest rate date", async () => {
    // The distinction the once-a-day guard rests on. Before the source
    // publishes today it answers with yesterday's date, so a guard keyed off
    // the answer would ask again on every page view until the afternoon.
    const fake = createFakeSupabase({
      fx_rates: { data: { fetched_at: "2026-08-25T09:00:00.000Z" } },
    });

    const asked = await createFxRateSnapshots(fake.client).lastFetchedAt();

    expect(asked?.toISOString()).toBe("2026-08-25T09:00:00.000Z");
    expect(fake.methodArgs("fx_rates", "order")).toEqual([
      ["fetched_at", { ascending: false }],
    ]);
  });

  it("asks about the pair the ledger prices in", async () => {
    const fake = createFakeSupabase({
      fx_rates: { data: { fetched_at: "2026-08-25T09:00:00.000Z" } },
    });

    await createFxRateSnapshots(fake.client).lastFetchedAt();

    expect(fake.methodArgs("fx_rates", "eq")).toEqual([
      ["base_currency", "USD"],
      ["quote_currency", "EUR"],
    ]);
  });

  it("answers null when nothing has ever been fetched", async () => {
    const fake = createFakeSupabase({ fx_rates: { data: null } });

    await expect(
      createFxRateSnapshots(fake.client).lastFetchedAt(),
    ).resolves.toBeNull();
  });

  it("answers null rather than throwing when the table cannot be read", async () => {
    // A guard that throws is a cost dashboard that will not render.
    const fake = createFakeSupabase({
      fx_rates: { error: { code: "42501", message: "denied" } },
    });

    await expect(
      createFxRateSnapshots(fake.client).lastFetchedAt(),
    ).resolves.toBeNull();
  });
});
