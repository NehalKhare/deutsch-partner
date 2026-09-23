import { describe, expect, it } from "vitest";

import type { ModelPrice } from "@dp/db/pricing-repository";

import { priceChange, rateChange, snapshotAgeDays } from "@/lib/pricing";

function model(over: Partial<ModelPrice>): ModelPrice {
  return {
    provider: "openrouter",
    modelId: "vendor/a",
    currency: "USD",
    inputUsdPerToken: 0.000003,
    outputUsdPerToken: 0.000004,
    fetchedAt: new Date("2026-09-22T04:13:00Z"),
    snapshots: 3,
    previous: null,
    ...over,
  };
}

describe("a model's price change", () => {
  it("is nothing when the price never moved", () => {
    expect(priceChange(model({}))).toBeNull();
  });

  it("states both sides as a percentage, and flags a rise", () => {
    const change = priceChange(
      model({
        previous: {
          inputUsdPerToken: 0.000002,
          outputUsdPerToken: 0.000004,
          fetchedAt: new Date("2026-09-20T04:13:00Z"),
        },
      }),
    );

    expect(change).toEqual({
      summary: "input +50%, output ±0%",
      up: true,
      since: new Date("2026-09-20T04:13:00Z"),
    });
  });

  it("does not flag a cut as a rise", () => {
    const change = priceChange(
      model({
        previous: {
          inputUsdPerToken: 0.000006,
          outputUsdPerToken: 0.000008,
          fetchedAt: new Date("2026-09-20T04:13:00Z"),
        },
      }),
    );

    expect(change?.summary).toBe("input −50%, output −50%");
    expect(change?.up).toBe(false);
  });

  it("says a price that was free became paid, rather than dividing by zero", () => {
    const change = priceChange(
      model({
        previous: { inputUsdPerToken: 0, outputUsdPerToken: 0.000004, fetchedAt: new Date() },
      }),
    );

    expect(change?.summary).toBe("input was free, output ±0%");
    expect(change?.up).toBe(true);
  });
});

describe("the euro rate's change", () => {
  const day = (rateDate: string, value: number) => ({
    rate: value,
    rateDate,
    source: "ecb",
    fetchedAt: new Date(`${rateDate}T07:07:00Z`),
  });

  it("is the difference from the previous row, signed", () => {
    expect(rateChange(day("2026-09-22", 0.93), day("2026-09-21", 0.92))).toBe("+0.0100");
    expect(rateChange(day("2026-09-22", 0.91), day("2026-09-21", 0.92))).toBe("−0.0100");
  });

  it("is a dash for the oldest row", () => {
    expect(rateChange(day("2026-09-22", 0.93), undefined)).toBe("—");
  });
});

describe("a snapshot's age", () => {
  it("is in days, fractional", () => {
    expect(snapshotAgeDays(new Date("2026-09-21T12:00:00Z"), new Date("2026-09-23T00:00:00Z"))).toBe(1.5);
  });
});
