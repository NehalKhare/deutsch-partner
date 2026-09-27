import { beforeEach, describe, expect, it, vi } from "vitest";

import { gatewayFail } from "@dp/gateway/errors";
import type { PlanCode } from "@dp/domain/plans";

import type { QuotaDecision } from "@/lib/api/quota";
import type { RequestPlan } from "@/lib/billing/entitlement";
import { fakeGraph, INPUT, type FakeOptions } from "../graph/fixtures";

/**
 * POST /api/chat, as the framework sees it: what is checked, in what order,
 * and what a refusal says. The turn itself is lib/api/chat.ts's and tested
 * there; here is that the plan is resolved on the server once, handed to the
 * turn, and counted against its daily quota by the turn — after the
 * per-minute limit, and only for a turn that is going ahead.
 */

const HASH = "0123456789abcdef0123456789abcdef";
const RESET = new Date(Date.now() + 3 * 3_600_000);

const state = vi.hoisted(() => ({
  learnerId: "11111111-1111-4111-8111-111111111111" as string | null,
  rateAllowed: true,
  plan: { plan: "free", readable: true } as { plan: string; readable: boolean },
  quota: null as unknown,
  graph: null as unknown,
  calls: [] as string[],
}));

vi.mock("@/lib/auth/current-user", () => ({
  getAuthenticatedUserId: async () => state.learnerId,
}));

vi.mock("@/lib/api/composition", () => ({
  pseudonymFor: () => "0123456789abcdef0123456789abcdef",
  createRequestGraph: async () => {
    state.calls.push("graph");
    return { deps: state.graph, logger: null };
  },
}));

vi.mock("@/lib/api/rate-limit", () => ({
  limiterFor: () => ({
    check: async () => {
      state.calls.push("rate_limit");
      return {
        allowed: state.rateAllowed,
        remaining: 0,
        resetAt: new Date(Date.now() + 30_000),
      };
    },
  }),
}));

vi.mock("@/lib/billing/entitlement", () => ({
  planForRequest: async (learnerId: string) => {
    state.calls.push(`plan:${learnerId}`);
    return state.plan;
  },
}));

vi.mock("@/lib/api/quota", () => ({
  consumeQuota: async (plan: string, kind: string, hash: string) => {
    state.calls.push(`quota:${plan}:${kind}:${hash}`);
    return state.quota;
  },
}));

const { POST } = await import("@/app/api/chat/route");

const ALLOWED: QuotaDecision = { allowed: true, remaining: 10, resetAt: RESET };

function given(options: {
  plan?: PlanCode;
  readable?: boolean;
  quota?: QuotaDecision;
  graph?: FakeOptions;
} = {}) {
  state.plan = { plan: options.plan ?? "free", readable: options.readable ?? true } satisfies RequestPlan;
  state.quota = options.quota ?? ALLOWED;
  const graph = fakeGraph(options.graph);
  state.graph = graph.deps;
  return graph;
}

const post = (body: unknown = { threadId: INPUT.threadId, message: INPUT.message }) =>
  POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

async function drained(response: Response): Promise<string> {
  return response.body ? await new Response(response.body).text() : "";
}

beforeEach(() => {
  state.learnerId = "11111111-1111-4111-8111-111111111111";
  state.rateAllowed = true;
  state.calls = [];
  given();
});

describe("before the plan is read", () => {
  it("sends a caller with no session to sign in, and reads no plan", async () => {
    state.learnerId = null;

    const response = await post();

    expect(response.status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("refuses a caller over the per-minute limit before anything is counted", async () => {
    state.rateAllowed = false;

    const response = await post();

    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("rate_limited");
    expect(state.calls).toEqual(["rate_limit"]);
  });

  it("refuses a body that is not JSON without spending a turn of the quota", async () => {
    const response = await post("{not json");

    expect(response.status).toBe(400);
    expect(state.calls.some((call) => call.startsWith("quota:"))).toBe(false);
  });
});

describe("the daily quota", () => {
  it("counts one tutor turn against the plan the learner's rows grant, after the per-minute limit", async () => {
    const response = await post();
    await drained(response);

    expect(response.status).toBe(200);
    expect(state.calls).toEqual([
      "rate_limit",
      `plan:${INPUT.learnerId}`,
      "graph",
      `quota:free:tutor_turns:${HASH}`,
    ]);
  });

  it("spends nothing on a body the schema refuses", async () => {
    const response = await post({ threadId: INPUT.threadId, message: "x".repeat(10_000) });

    expect(response.status).toBe(400);
    expect(state.calls.some((call) => call.startsWith("quota:"))).toBe(false);
  });

  it("spends nothing on a thread that is not the learner's", async () => {
    given({ graph: { threadMissing: true } });

    const response = await post();

    expect(response.status).toBe(404);
    expect(state.calls.some((call) => call.startsWith("quota:"))).toBe(false);
  });

  it("refuses a spent quota with when it reopens, and never opens the turn", async () => {
    const graph = given({ quota: { allowed: false, refusal: "quota_exhausted", resetAt: RESET } });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({
      error: "quota_exhausted",
      resetAt: RESET.toISOString(),
      upgrade: true,
    });
    expect(body.message.length).toBeGreaterThan(10);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(3 * 3_600 - 5);
    expect(graph.gatewaySpecs).toEqual([]);
  });

  it("answers a quota store that could not count as an outage: 503, a short wait, no upgrade", async () => {
    // Not "you've used today's turns": nothing was counted, and no plan would help.
    const graph = given({ quota: { allowed: false, refusal: "unavailable", resetAt: null } });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("generation_failed");
    expect(body).not.toHaveProperty("upgrade");
    expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(graph.gatewaySpecs).toEqual([]);
  });

  it("offers a Premium learner no upgrade, only the time it reopens", async () => {
    given({ plan: "premium", quota: { allowed: false, refusal: "quota_exhausted", resetAt: RESET } });

    const body = await (await post()).json();

    expect(body).toMatchObject({ error: "quota_exhausted", upgrade: false });
  });

  it("offers no upgrade to a learner whose plan could not be read", async () => {
    given({ readable: false, quota: { allowed: false, refusal: "quota_exhausted", resetAt: RESET } });

    expect((await (await post()).json()).upgrade).toBe(false);
  });

  it("answers a plan that does not include the tutor as 402, with nothing to wait for", async () => {
    given({ quota: { allowed: false, refusal: "plan_required", resetAt: null } });

    const response = await post();

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: "plan_required", resetAt: null, upgrade: true });
    expect(response.headers.get("retry-after")).toBeNull();
  });
});

describe("the turn", () => {
  it("runs on the plan the server resolved", async () => {
    const graph = given({ plan: "free" });

    await drained(await post());

    expect(graph.gatewaySpecs[0]).toMatchObject({ tier: "mid", plan: "free" });
    expect(graph.gatewayContexts[0]).toMatchObject({ plan: "free" });
  });

  it("cannot be told a plan by the body", async () => {
    // The schema is strict; a claimed plan is an invalid body, not a better tutor.
    const response = await post({ threadId: INPUT.threadId, message: INPUT.message, plan: "premium" });

    expect(response.status).toBe(400);
    expect(state.calls.some((call) => call.startsWith("quota:"))).toBe(false);
  });

  it("says a spent allowance is a spent allowance, with when it renews", async () => {
    given({
      graph: { generation: gatewayFail("budget_denied", "per_user_monthly", "per_user_monthly") },
    });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(429);
    // The fixture's clock is 2026-08-21.
    expect(body).toMatchObject({
      error: "budget_exhausted",
      resetAt: "2026-09-01T00:00:00.000Z",
      upgrade: true,
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(response.headers.get("retry-after")).not.toBeNull();
  });

  it("keeps an unreadable counter an outage rather than an upsell", async () => {
    given({ graph: { generation: gatewayFail("budget_denied", "unavailable", null) } });

    const response = await post();

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("generation_failed");
  });
});
