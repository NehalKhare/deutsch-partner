import { describe, expect, it, vi } from "vitest";

import type { FxRateSnapshots } from "@dp/gateway/fx";
import { ensureDailyRate } from "@/fx/fx-refresh";

/**
 * How often the source is actually asked.
 *
 * Once a day, and the guard is when it was last read rather than which date it
 * answered with. Those are different every morning — the reference rate for a
 * day is published in the afternoon — and a guard on the answer's date would
 * ask again on every page view until it appeared.
 */

const RATE = { eurPerUsd: 0.8, rateDate: "2026-08-24", source: "ecb" };
const NOON = new Date("2026-08-25T12:00:00.000Z");

function snapshots(lastFetchedAt: Date | null, saves = { ok: true } as const) {
  const saved: unknown[] = [];
  const store: FxRateSnapshots = {
    async lastFetchedAt() {
      return lastFetchedAt;
    },
    async save(rate) {
      saved.push(rate);
      return saves;
    },
  };
  return { store, saved };
}

describe("asking the source at most once a day", () => {
  it("asks when nothing has ever been fetched", async () => {
    const { store, saved } = snapshots(null);
    const fetchRate = vi.fn(async () => RATE);

    const outcome = await ensureDailyRate({ snapshots: store, fetchRate, now: () => NOON });

    expect(outcome).toEqual({ status: "fetched", rate: RATE });
    expect(fetchRate).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([RATE]);
  });

  it("does not ask twice in a day", async () => {
    const { store, saved } = snapshots(new Date("2026-08-25T09:00:00.000Z"));
    const fetchRate = vi.fn(async () => RATE);

    const outcome = await ensureDailyRate({ snapshots: store, fetchRate, now: () => NOON });

    expect(outcome).toEqual({ status: "asked_today" });
    expect(fetchRate).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("asks again the next day", async () => {
    const { store } = snapshots(new Date("2026-08-24T16:00:00.000Z"));
    const fetchRate = vi.fn(async () => RATE);

    await ensureDailyRate({ snapshots: store, fetchRate, now: () => NOON });

    expect(fetchRate).toHaveBeenCalledTimes(1);
  });

  it("keeps asking while the source still owes today's rate", async () => {
    // The case the guard exists for. It is morning, the source has published
    // nothing for today, and the newest rate we hold is stamped yesterday. A
    // guard that asked "do we have today's rate" would fetch on every render;
    // this one has asked today already and stops.
    const { store, saved } = snapshots(new Date("2026-08-25T07:00:00.000Z"));
    const fetchRate = vi.fn(async () => RATE);

    const outcome = await ensureDailyRate({ snapshots: store, fetchRate, now: () => NOON });

    expect(outcome.status).toBe("asked_today");
    expect(saved).toEqual([]);
  });
});

describe("asking anyway", () => {
  it("fetches when forced, however recently it was asked", async () => {
    const { store, saved } = snapshots(new Date("2026-08-25T11:59:00.000Z"));
    const fetchRate = vi.fn(async () => RATE);

    const outcome = await ensureDailyRate(
      { snapshots: store, fetchRate, now: () => NOON },
      { force: true },
    );

    expect(outcome.status).toBe("fetched");
    expect(saved).toEqual([RATE]);
  });

  it("does not read the guard at all when forced", async () => {
    const lastFetchedAt = vi.fn(async () => NOON);
    const store: FxRateSnapshots = {
      lastFetchedAt,
      async save() {
        return { ok: true };
      },
    };

    await ensureDailyRate(
      { snapshots: store, fetchRate: async () => RATE, now: () => NOON },
      { force: true },
    );

    expect(lastFetchedAt).not.toHaveBeenCalled();
  });
});

describe("when it goes wrong", () => {
  it("leaves the last known rate in place when the source cannot be read", async () => {
    // Never a throw and never a substitute figure: the reader already knows
    // how to carry a rate forward, and a currency feed being down is not this
    // product being down.
    const { store, saved } = snapshots(null);

    const outcome = await ensureDailyRate({
      snapshots: store,
      fetchRate: async () => null,
      now: () => NOON,
    });

    expect(outcome).toEqual({ status: "unavailable" });
    expect(saved).toEqual([]);
  });

  it("reports a refused write rather than claiming to have stored it", async () => {
    const store: FxRateSnapshots = {
      async lastFetchedAt() {
        return null;
      },
      async save() {
        return { ok: false, detail: "42501" };
      },
    };

    const outcome = await ensureDailyRate({
      snapshots: store,
      fetchRate: async () => RATE,
      now: () => NOON,
    });

    expect(outcome).toEqual({ status: "not_stored", detail: "42501" });
  });
});
