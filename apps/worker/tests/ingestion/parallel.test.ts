import { describe, expect, it } from "vitest";

import { mapBounded } from "@/ingestion/parallel";

describe("mapBounded", () => {
  it("returns results in input order whatever order they finish in", async () => {
    const delays = [30, 5, 15, 1];

    const results = await mapBounded(delays, 4, async (ms, index) => {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
      return `${index}:${ms}`;
    });

    expect(results).toEqual(["0:30", "1:5", "2:15", "3:1"]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;

    await mapBounded(Array.from({ length: 12 }, (_, index) => index), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 5));
      running -= 1;
    });

    expect(peak).toBe(3);
  });

  it("keeps working the queue after a slow item", async () => {
    const finished: number[] = [];

    await mapBounded([50, 1, 1, 1], 2, async (ms, index) => {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
      finished.push(index);
    });

    // The slow first item must not have blocked the second worker from
    // draining the rest.
    expect(finished[finished.length - 1]).toBe(0);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapBounded([], 4, async (item: number) => item)).toEqual([]);
    expect(await mapBounded([1, 2], 16, async (item) => item * 2)).toEqual([2, 4]);
  });
});
