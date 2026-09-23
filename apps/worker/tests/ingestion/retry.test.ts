import { describe, expect, it, vi } from "vitest";

import { withRetry } from "@/ingestion/retry";

const noSleep = async () => {};

describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    expect(await withRetry(operation, { attempts: 3, baseDelayMs: 0, sleep: noSleep })).toBe(
      "ok",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries until it succeeds", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValue("ok");

    expect(await withRetry(operation, { attempts: 3, baseDelayMs: 0, sleep: noSleep })).toBe(
      "ok",
    );
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last attempt and rethrows", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("always"));

    await expect(
      withRetry(operation, { attempts: 2, baseDelayMs: 0, sleep: noSleep }),
    ).rejects.toThrow("always");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry what will fail the same way every time", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("malformed"));

    await expect(
      withRetry(operation, {
        attempts: 5,
        baseDelayMs: 0,
        sleep: noSleep,
        isRetryable: () => false,
      }),
    ).rejects.toThrow("malformed");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially, so an overloaded provider is left alone", async () => {
    const waits: number[] = [];
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("a"))
      .mockRejectedValueOnce(new Error("b"))
      .mockResolvedValue("ok");

    await withRetry(operation, {
      attempts: 3,
      baseDelayMs: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([100, 200]);
  });

  it("waits after a failure and never after the last attempt", async () => {
    const waits: number[] = [];
    const operation = vi.fn().mockRejectedValue(new Error("always"));

    await expect(
      withRetry(operation, {
        attempts: 3,
        baseDelayMs: 10,
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(waits).toHaveLength(2);
  });

  it("reports each retry to the caller", async () => {
    const onRetry = vi.fn();
    const operation = vi.fn().mockRejectedValueOnce(new Error("a")).mockResolvedValue("ok");

    await withRetry(operation, { attempts: 2, baseDelayMs: 0, sleep: noSleep, onRetry });

    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });
});
