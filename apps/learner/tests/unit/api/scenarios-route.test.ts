import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/scenarios/search, as the framework sees it: the search embeds the
 * learner's query on their pseudonym, so it is charged to their own euro
 * allowance — and a per-learner allowance is read against the learner's plan
 * (billing-and-plans-spec.md S9). Resolved on the server, like every other
 * learner-facing model call; never taken from the body.
 */

const state = vi.hoisted(() => ({
  identities: [] as unknown[],
  calls: [] as string[],
}));

vi.mock("@/lib/auth/current-user", () => ({
  getAuthenticatedUserId: async () => "11111111-1111-4111-8111-111111111111",
}));

vi.mock("@/lib/api/composition", () => ({
  pseudonymFor: () => "0123456789abcdef0123456789abcdef",
  createScenarioSearch: async () => ({ deps: {} }),
}));

vi.mock("@/lib/api/rate-limit", () => ({
  limiterFor: () => ({
    check: async () => {
      state.calls.push("rate_limit");
      return { allowed: true, remaining: 1, resetAt: new Date(Date.now() + 60_000) };
    },
  }),
}));

vi.mock("@/lib/billing/entitlement", () => ({
  planForRequest: async (learnerId: string) => {
    state.calls.push(`plan:${learnerId}`);
    return { plan: "premium", readable: true };
  },
}));

vi.mock("@/lib/api/scenarios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scenarios")>()),
  handleScenarioSearch: async (_body: unknown, identity: unknown) => {
    state.identities.push(identity);
    return { ok: true, results: [] };
  },
}));

const { POST } = await import("@/app/api/scenarios/search/route");

beforeEach(() => {
  state.identities = [];
  state.calls = [];
});

describe("POST /api/scenarios/search", () => {
  it("searches on the plan the learner's rows grant, after the per-minute limit", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/scenarios/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "beim Bäcker", plan: "free" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.calls).toEqual(["rate_limit", "plan:11111111-1111-4111-8111-111111111111"]);
    expect(state.identities[0]).toMatchObject({ userIdHash: "0123456789abcdef0123456789abcdef", plan: "premium" });
  });
});
