import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuotaDecision } from "@/lib/api/quota";
import type { TrainerResult } from "@/lib/api/trainer";

/**
 * POST /api/trainer, as the framework sees it. The loop is lib/api/trainer.ts's
 * and tested there; here is that the plan is resolved on the server, the
 * handler is given the admission that counts one Trainer request against the
 * plan's day — telling it whether the request continues a session — and a
 * refusal says when it reopens without touching the session the browser holds.
 */

const HASH = "0123456789abcdef0123456789abcdef";
const LEARNER = "11111111-1111-4111-8111-111111111111";
const RESET = new Date(Date.now() + 5 * 3_600_000);

const state = vi.hoisted(() => ({
  learnerId: "11111111-1111-4111-8111-111111111111" as string | null,
  rateAllowed: true,
  plan: { plan: "free", readable: true } as { plan: string; readable: boolean },
  quota: null as unknown,
  result: null as unknown,
  identities: [] as unknown[],
  calls: [] as string[],
}));

vi.mock("@/lib/auth/current-user", () => ({
  getAuthenticatedUserId: async () => state.learnerId,
}));

vi.mock("@/lib/api/composition", () => ({
  pseudonymFor: () => "0123456789abcdef0123456789abcdef",
  createTrainerGraph: async () => {
    state.calls.push("graph");
    return { deps: {}, logger: null };
  },
}));

vi.mock("@/lib/api/rate-limit", () => ({
  limiterFor: () => ({
    check: async () => {
      state.calls.push("rate_limit");
      return { allowed: state.rateAllowed, remaining: 0, resetAt: new Date(Date.now() + 30_000) };
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
  consumeTrainerQuota: async (plan: string, hash: string, session: { continuing: boolean }) => {
    state.calls.push(`quota:${plan}:trainer_requests:${hash}:${session.continuing ? "continuing" : "opening"}`);
    return state.quota;
  },
}));

// The handler as the route sees it: a function that asks the admission it is
// given, as the real one does after its own checks, and answers the refusal.
vi.mock("@/lib/api/trainer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/trainer")>()),
  handleTrainerTurn: async (
    body: { agenda?: unknown },
    identity: unknown,
    _deps: unknown,
    admit?: (session: { continuing: boolean }) => Promise<QuotaDecision>,
  ) => {
    state.identities.push(identity);
    const admission = await admit?.({ continuing: body.agenda !== undefined });
    if (admission && !admission.allowed) {
      return admission.refusal === "unavailable"
        ? { ok: false, error: "generation_failed", retryAfterSeconds: 30 }
        : { ok: false, error: admission.refusal, resetAt: admission.resetAt };
    }
    return state.result;
  },
}));

const { POST } = await import("@/app/api/trainer/route");

const PAYLOAD = {
  reply: "Gern!",
  steps: [],
  sources: [],
  agenda: null,
  covered: [],
  complete: false,
  coaching: {},
  costEur: 0,
};

const post = (body: unknown = { message: "Lass uns üben!" }) =>
  POST(
    new Request("http://localhost:3000/api/trainer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  state.learnerId = LEARNER;
  state.rateAllowed = true;
  state.plan = { plan: "free", readable: true };
  state.quota = { allowed: true, remaining: 10, resetAt: RESET } satisfies QuotaDecision;
  state.result = { ok: true, payload: PAYLOAD } as unknown as TrainerResult;
  state.identities = [];
  state.calls = [];
});

describe("before the plan is read", () => {
  it("sends a caller with no session to sign in, and reads no plan", async () => {
    state.learnerId = null;

    expect((await post()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("refuses a caller over the per-minute limit before anything is counted", async () => {
    state.rateAllowed = false;

    expect((await post()).status).toBe(429);
    expect(state.calls).toEqual(["rate_limit"]);
  });

  it("refuses a body that is not JSON without spending a request of the quota", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect(state.calls.some((call) => call.startsWith("quota:"))).toBe(false);
  });
});

describe("the daily quota", () => {
  it("counts one Trainer request against the plan the learner's rows grant", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(state.calls).toEqual([
      "rate_limit",
      `plan:${LEARNER}`,
      "graph",
      `quota:free:trainer_requests:${HASH}:opening`,
    ]);
  });

  it("tells the quota when a request continues a session under way", async () => {
    await post({ message: "Weiter!", agenda: [{ kind: "recall", subject: "fahren" }] });

    expect(state.calls).toContain(`quota:free:trainer_requests:${HASH}:continuing`);
  });

  it("refuses a spent quota with when it reopens", async () => {
    state.quota = { allowed: false, refusal: "quota_exhausted", resetAt: RESET } satisfies QuotaDecision;

    const response = await post();

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: "quota_exhausted",
      resetAt: RESET.toISOString(),
      upgrade: true,
    });
    expect(response.headers.get("retry-after")).not.toBeNull();
  });

  it("answers a quota store that could not count as an outage: 503, a short wait, no upgrade", async () => {
    state.quota = { allowed: false, refusal: "unavailable", resetAt: null } satisfies QuotaDecision;

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("generation_failed");
    expect(body).not.toHaveProperty("upgrade");
    expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(60);
  });

  it("offers a Premium learner no upgrade", async () => {
    state.plan = { plan: "premium", readable: true };
    state.quota = { allowed: false, refusal: "quota_exhausted", resetAt: RESET } satisfies QuotaDecision;

    expect((await (await post()).json()).upgrade).toBe(false);
  });

  it("answers a plan that does not include the Trainer as 402", async () => {
    state.quota = { allowed: false, refusal: "plan_required", resetAt: null } satisfies QuotaDecision;

    const response = await post();

    expect(response.status).toBe(402);
    expect((await response.json()).error).toBe("plan_required");
  });
});

describe("the loop", () => {
  it("runs on the plan the server resolved", async () => {
    state.plan = { plan: "plus", readable: true };

    await post();

    expect(state.identities[0]).toMatchObject({ learnerId: LEARNER, userIdHash: HASH, plan: "plus" });
  });

  it("says a spent allowance is a spent allowance, with when it renews", async () => {
    state.result = { ok: false, error: "budget_exhausted", resetAt: RESET } satisfies TrainerResult;

    const response = await post();

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: "budget_exhausted",
      resetAt: RESET.toISOString(),
      upgrade: true,
      requestId: expect.any(String),
    });
    expect(response.headers.get("retry-after")).not.toBeNull();
  });

  it("keeps a plain budget refusal plain", async () => {
    state.result = { ok: false, error: "budget_denied" } satisfies TrainerResult;

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("budget_denied");
    expect(body).not.toHaveProperty("upgrade");
  });
});
