import { describe, expect, it, vi } from "vitest";

import {
  RATE_STALE_AFTER_MS,
  estimateUsd,
  isRateStale,
  resolveRate,
  type ModelRate,
  type PricingStore,
} from "../src/pricing";

const NOW = new Date("2026-08-21T10:00:00.000Z");

const rate = (over: Partial<ModelRate> = {}): ModelRate => ({
  provider: "openrouter",
  modelId: "vendor/model",
  inputRate: 0.000002,
  outputRate: 0.00001,
  currency: "USD",
  fetchedAt: NOW,
  ...over,
});

describe("estimating cost from a cached snapshot", () => {
  it("multiplies each direction by its own rate", () => {
    expect(estimateUsd(rate(), { inputTokens: 1000, outputTokens: 200 })).toBeCloseTo(
      0.004,
      10,
    );
  });

  it("returns nothing when no snapshot exists, rather than assuming free", () => {
    // A missing price is unknown, not zero. Zero would silently exempt a model
    // from every budget it should be counted against.
    expect(estimateUsd(null, { inputTokens: 1000, outputTokens: 200 })).toBeNull();
  });

  it("refuses to price a snapshot that is not in dollars", () => {
    expect(
      estimateUsd(rate({ currency: "EUR" }), { inputTokens: 10, outputTokens: 10 }),
    ).toBeNull();
  });

  it("prices a call that produced nothing at zero", () => {
    expect(estimateUsd(rate(), { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe("snapshot freshness", () => {
  it("accepts a snapshot fetched recently", () => {
    expect(isRateStale(rate({ fetchedAt: new Date(NOW.getTime() - 1000) }), NOW)).toBe(
      false,
    );
  });

  it("flags a snapshot older than the refresh window", () => {
    const old = new Date(NOW.getTime() - RATE_STALE_AFTER_MS - 1);

    expect(isRateStale(rate({ fetchedAt: old }), NOW)).toBe(true);
  });
});

describe("resolveRate", () => {
  it("looks the model up by provider and id", async () => {
    const store: PricingStore = { latestFor: vi.fn().mockResolvedValue(rate()) };

    await resolveRate(store, "openrouter", "vendor/model");

    expect(store.latestFor).toHaveBeenCalledWith("openrouter", "vendor/model");
  });

  it("returns nothing when the store fails, rather than throwing into a dispatch", async () => {
    const store: PricingStore = {
      latestFor: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    await expect(resolveRate(store, "openrouter", "vendor/model")).resolves.toBeNull();
  });
});
