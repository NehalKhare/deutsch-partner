import { describe, expect, it, vi } from "vitest";

import { createFxRateService, isoDate, toEur, type FxRateStore } from "../src/fx";
import { createLogger } from "@dp/observability/logger";

const TODAY = new Date("2026-08-21T10:00:00.000Z");

function storeReturning(
  value: Awaited<ReturnType<FxRateStore["latestOnOrBefore"]>>,
): FxRateStore {
  return { latestOnOrBefore: vi.fn().mockResolvedValue(value) };
}

describe("fx rate service", () => {
  it("uses today's rate and does not call it stale", async () => {
    const service = createFxRateService(
      storeReturning({ eurPerUsd: 0.92, rateDate: "2026-08-21", source: "ecb" }),
    );

    expect(await service.resolve(TODAY)).toEqual({
      eurPerUsd: 0.92,
      rateDate: "2026-08-21",
      source: "ecb",
      stale: false,
    });
  });

  it("carries the most recent rate forward and flags it stale", async () => {
    const service = createFxRateService(
      storeReturning({ eurPerUsd: 0.9, rateDate: "2026-08-18", source: "ecb" }),
    );

    const rate = await service.resolve(TODAY);

    expect(rate).toMatchObject({ eurPerUsd: 0.9, rateDate: "2026-08-18", stale: true });
  });

  it("returns nothing rather than blocking when no rate has ever been snapshotted", async () => {
    const service = createFxRateService(storeReturning(null));

    expect(await service.resolve(TODAY)).toBeNull();
  });

  it("survives a store that throws, because a call is never blocked on FX", async () => {
    const lines: string[] = [];
    const service = createFxRateService(
      { latestOnOrBefore: vi.fn().mockRejectedValue(new Error("connection refused")) },
      { logger: createLogger({ sink: (line) => lines.push(line) }) },
    );

    await expect(service.resolve(TODAY)).resolves.toBeNull();
    expect(lines.join("\n")).toContain("fx.lookup_failed");
  });

  it("falls back to a configured bootstrap rate before the first snapshot lands", async () => {
    const service = createFxRateService(storeReturning(null), {
      bootstrap: { eurPerUsd: 0.93, source: "configured" },
    });

    expect(await service.resolve(TODAY)).toMatchObject({
      eurPerUsd: 0.93,
      source: "configured",
      stale: true,
    });
  });

  it("prefers a snapshotted rate over the bootstrap", async () => {
    const service = createFxRateService(
      storeReturning({ eurPerUsd: 0.91, rateDate: "2026-08-21", source: "ecb" }),
      { bootstrap: { eurPerUsd: 0.5, source: "configured" } },
    );

    expect((await service.resolve(TODAY))?.eurPerUsd).toBe(0.91);
  });

  it("asks the store for a rate on or before the day being priced", async () => {
    const store = storeReturning(null);
    await createFxRateService(store).resolve(TODAY);

    expect(store.latestOnOrBefore).toHaveBeenCalledWith("2026-08-21");
  });

  it("caches within a day so one turn does not re-query per call", async () => {
    const store = storeReturning({
      eurPerUsd: 0.92,
      rateDate: "2026-08-21",
      source: "ecb",
    });
    const service = createFxRateService(store);

    await service.resolve(TODAY);
    await service.resolve(new Date("2026-08-21T23:00:00.000Z"));
    await service.resolve(new Date("2026-08-22T00:30:00.000Z"));

    expect(store.latestOnOrBefore).toHaveBeenCalledTimes(2);
  });
});

describe("conversion", () => {
  it("converts at the rate it was handed", () => {
    const rate = { eurPerUsd: 0.92, rateDate: "2026-08-21", source: "ecb", stale: false };

    expect(toEur(0.0125, rate)).toBeCloseTo(0.0115, 8);
  });

  it("returns zero when there is no rate, rather than guessing one", () => {
    expect(toEur(0.0125, null)).toBe(0);
  });

  it("keeps a converted figure fixed when the rate later moves", () => {
    const monday = { eurPerUsd: 0.92, rateDate: "2026-08-17", source: "ecb", stale: false };
    const friday = { eurPerUsd: 0.85, rateDate: "2026-08-21", source: "ecb", stale: false };

    const recorded = toEur(1, monday);

    expect(recorded).toBeCloseTo(0.92, 8);
    expect(toEur(1, friday)).toBeCloseTo(0.85, 8);
    expect(recorded).toBeCloseTo(0.92, 8);
  });

  it("rounds to the precision the ledger column stores", () => {
    const rate = { eurPerUsd: 0.923456789, rateDate: "2026-08-21", source: "ecb", stale: false };

    expect(toEur(0.000000123456, rate)).toBe(Number(toEur(0.000000123456, rate).toFixed(8)));
  });
});

describe("isoDate", () => {
  it("formats a UTC day", () => {
    expect(isoDate(new Date("2026-08-21T23:59:59.999Z"))).toBe("2026-08-21");
  });
});
