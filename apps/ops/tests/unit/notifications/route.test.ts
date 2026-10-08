import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/notifications: an operator or 404, the quota, then the feed.
 */

const state = vi.hoisted(() => ({
  operator: { id: "op", email: null, hash: "hash-op", aal: "aal2" } as unknown,
  allowed: true,
  reads: 0,
}));

vi.mock("@/lib/auth/require-operator", () => ({ operatorForRequest: async () => state.operator }));
vi.mock("@/lib/api/rate-limit", () => ({
  limiterFor: (scope: string) => ({
    check: async () => {
      if (scope !== "ops_notifications") throw new Error(`wrong scope ${scope}`);
      return { allowed: state.allowed, remaining: 0, resetAt: new Date(Date.now() + 30_000) };
    },
  }),
}));
vi.mock("@/lib/notifications", () => ({
  readOpsFeed: async () => {
    state.reads += 1;
    return { unread: 3, items: [] };
  },
}));

const { GET } = await import("@/app/api/notifications/route");

beforeEach(() => {
  state.operator = { id: "op", email: null, hash: "hash-op", aal: "aal2" };
  state.allowed = true;
  state.reads = 0;
});

describe("GET /api/notifications", () => {
  it("answers the feed, uncached, to an operator", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ unread: 3, items: [] });
  });

  it("answers 404, not 403, to anyone else, and reads nothing", async () => {
    state.operator = null;

    const response = await GET();

    expect(response.status).toBe(404);
    expect(state.reads).toBe(0);
  });

  it("answers 429 with a retry-after when polled too eagerly", async () => {
    state.allowed = false;

    const response = await GET();

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
