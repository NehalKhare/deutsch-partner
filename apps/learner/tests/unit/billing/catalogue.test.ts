import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryBillingStore } from "@dp/billing/testing/memory-store";

import { ALL_PRICES } from "./fixtures";

/**
 * Reading the price mirror for a page.
 *
 * The pricing page and the landing page both render from this, and neither
 * may break because of it: a failed read is "unavailable", said once in the
 * log at warn, and never a thrown error or an invented figure.
 */

const warn = vi.fn();
const reader = vi.hoisted(() => ({ current: null as null | (() => unknown) }));

vi.mock("@/lib/api/composition", () => ({
  billingLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
  createPriceReader: () => reader.current!(),
}));

const { currentPrices } = await import("@/lib/billing/catalogue");

beforeEach(() => {
  warn.mockReset();
});

describe("currentPrices", () => {
  it("is the mirror's active rows", async () => {
    const store = createMemoryBillingStore();
    await store.replacePrices(ALL_PRICES, new Date("2026-09-25T08:00:00Z"));
    reader.current = () => store;

    const list = await currentPrices();

    expect(list.status).toBe("ready");
    expect(list.status === "ready" && list.prices.map((row) => row.lookupKey)).toHaveLength(ALL_PRICES.length);
  });

  it("is ready and empty before the first sync, which a page says as 'being set up'", async () => {
    reader.current = () => createMemoryBillingStore();

    expect(await currentPrices()).toEqual({ status: "ready", prices: [] });
  });

  it("is unavailable when the read fails, and says so at warn", async () => {
    const store = createMemoryBillingStore();
    store.failWith("activePrices", "unavailable");
    reader.current = () => store;

    expect(await currentPrices()).toEqual({ status: "unavailable" });
    expect(warn).toHaveBeenCalledWith("billing.prices_unavailable", { kind: "unavailable" });
  });

  it("is unavailable when there is not even a client to read with", async () => {
    // A laptop with no secret key, or a build container with no secrets.
    reader.current = () => {
      throw new Error("SUPABASE_SECRET_KEY is required");
    };

    expect(await currentPrices()).toEqual({ status: "unavailable" });
    expect(warn).toHaveBeenCalledWith("billing.prices_unavailable", { kind: "thrown" });
  });
});
