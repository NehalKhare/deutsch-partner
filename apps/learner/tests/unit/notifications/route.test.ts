import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/notifications, as the framework sees it: a session or 401, the
 * limiter, then the feed. The feed itself is lib/notifications's and tested
 * there; here it is whatever the fake returns.
 */

const state = vi.hoisted(() => ({
  learnerId: "11111111-1111-4111-8111-111111111111" as string | null,
  allowed: true,
  feed: { unread: 2, items: [] } as unknown,
  reads: 0,
}));

vi.mock("@/lib/auth/current-user", () => ({ getAuthenticatedUserId: async () => state.learnerId }));
vi.mock("@/lib/api/composition", () => ({ pseudonymOrUnavailable: () => "hash-alice" }));
vi.mock("@/lib/api/rate-limit", () => ({
  limiterFor: (scope: string) => ({
    check: async () => {
      if (scope !== "notifications") throw new Error(`wrong scope ${scope}`);
      return { allowed: state.allowed, remaining: 0, resetAt: new Date(Date.now() + 30_000) };
    },
  }),
}));
vi.mock("@/lib/notifications/server", () => ({
  readOwnFeed: async () => {
    state.reads += 1;
    return state.feed;
  },
}));

const { GET } = await import("@/app/api/notifications/route");

beforeEach(() => {
  state.learnerId = "11111111-1111-4111-8111-111111111111";
  state.allowed = true;
  state.reads = 0;
});

describe("GET /api/notifications", () => {
  it("answers the feed, uncached", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ unread: 2, items: [] });
  });

  it("answers 401 without reading anything when there is no session", async () => {
    state.learnerId = null;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(state.reads).toBe(0);
  });

  it("answers 429 with a retry-after when the poll is too eager", async () => {
    state.allowed = false;

    const response = await GET();

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(state.reads).toBe(0);
  });
});
