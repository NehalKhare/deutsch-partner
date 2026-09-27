// @vitest-environment node
// The routes run on Node, and a multipart body parsed by Node's Request holds
// Node's File, which is no instance of jsdom's Blob.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSpeechToText, createMockTextToSpeech } from "@dp/gateway/voice/mock";

import type { QuotaDecision } from "@/lib/api/quota";

/**
 * POST /api/transcribe and POST /api/speak, as the framework sees them.
 *
 * The rules are lib/api/voice.ts's and tested there. Here is what each route
 * adds for plans (billing-and-plans-spec.md S2): the plan comes from the
 * learner's rows, a transcription counts against the plan's daily
 * transcriptions, and a model voice line needs a plan with the model voice
 * and then counts against its daily voice lines. The device's own voice is
 * not here at all — it never reaches the server, on any plan.
 */

const HASH = "0123456789abcdef0123456789abcdef";
const LEARNER = "11111111-1111-4111-8111-111111111111";
const RESET = new Date(Date.now() + 2 * 3_600_000);

const state = vi.hoisted(() => ({
  learnerId: "11111111-1111-4111-8111-111111111111" as string | null,
  rateAllowed: true,
  plan: { plan: "free", readable: true } as { plan: string; readable: boolean },
  quota: null as unknown,
  providers: null as unknown,
  calls: [] as string[],
}));

vi.mock("@/lib/auth/current-user", () => ({
  getAuthenticatedUserId: async () => state.learnerId,
}));

vi.mock("@/lib/api/composition", () => ({
  pseudonymFor: () => "0123456789abcdef0123456789abcdef",
  createVoiceProviders: () => state.providers,
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
  consumeQuota: async (plan: string, kind: string, hash: string) => {
    state.calls.push(`quota:${plan}:${kind}:${hash}`);
    return state.quota;
  },
}));

const transcribe = (await import("@/app/api/transcribe/route")).POST;
const speak = (await import("@/app/api/speak/route")).POST;

let stt = createMockSpeechToText({ transcript: "Ich möchte einen Kaffee." });
let tts = createMockTextToSpeech();

function recording(bytes = 2048, type = "audio/webm") {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(bytes).fill(7)], { type }));
  form.set("durationMs", "2500");
  return transcribe(new Request("http://localhost:3000/api/transcribe", { method: "POST", body: form }));
}

const line = (body: unknown = { text: "Wie geht es dir?", cefr: "A2" }) =>
  speak(
    new Request("http://localhost:3000/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const quotaCalls = () => state.calls.filter((call) => call.startsWith("quota:"));

beforeEach(() => {
  stt = createMockSpeechToText({ transcript: "Ich möchte einen Kaffee." });
  tts = createMockTextToSpeech();
  state.providers = { speechToText: stt, textToSpeech: tts };
  state.learnerId = LEARNER;
  state.rateAllowed = true;
  state.plan = { plan: "free", readable: true };
  state.quota = { allowed: true, remaining: 3, resetAt: RESET } satisfies QuotaDecision;
  state.calls = [];
});

describe("POST /api/transcribe", () => {
  it("sends a caller with no session to sign in, and reads no plan", async () => {
    state.learnerId = null;

    expect((await recording()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("refuses a caller over the per-minute limit before anything is counted", async () => {
    state.rateAllowed = false;

    expect((await recording()).status).toBe(429);
    expect(quotaCalls()).toEqual([]);
  });

  it("counts one transcription against the plan the learner's rows grant", async () => {
    const response = await recording();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Ich möchte einen Kaffee." });
    expect(state.calls).toContain(`plan:${LEARNER}`);
    expect(quotaCalls()).toEqual([`quota:free:transcriptions:${HASH}`]);
  });

  it("counts nothing for a recording in a format it cannot read", async () => {
    const response = await recording(2048, "audio/flac");

    expect(response.status).toBe(415);
    expect(quotaCalls()).toEqual([]);
  });

  it("refuses a spent allowance with when it reopens, and never uploads the clip", async () => {
    state.quota = { allowed: false, refusal: "quota_exhausted", resetAt: RESET } satisfies QuotaDecision;

    const response = await recording();

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: "quota_exhausted",
      resetAt: RESET.toISOString(),
      upgrade: true,
    });
    expect(response.headers.get("retry-after")).not.toBeNull();
    expect(stt.calls).toHaveLength(0);
  });

  it("offers a Premium learner no upgrade", async () => {
    state.plan = { plan: "premium", readable: true };
    state.quota = { allowed: false, refusal: "quota_exhausted", resetAt: RESET } satisfies QuotaDecision;

    expect((await (await recording()).json()).upgrade).toBe(false);
  });
});

describe("POST /api/speak", () => {
  it("refuses a plan without the model voice as 402, counting nothing, so the page uses the device's voice", async () => {
    // Free has no model voice lines (spec S2); the device's own voice is
    // unlimited and never asks the server.
    const response = await line();

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: "plan_required", resetAt: null, upgrade: true });
    expect(quotaCalls()).toEqual([]);
    expect(tts.calls).toHaveLength(0);
  });

  it("speaks for a plan with the model voice, counting one voice line", async () => {
    state.plan = { plan: "plus", readable: true };

    const response = await line();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^audio\//);
    expect(quotaCalls()).toEqual([`quota:plus:voice_lines:${HASH}`]);
    expect(tts.calls).toHaveLength(1);
  });

  it("refuses a spent voice allowance with when it reopens", async () => {
    state.plan = { plan: "plus", readable: true };
    state.quota = { allowed: false, refusal: "quota_exhausted", resetAt: RESET } satisfies QuotaDecision;

    const response = await line();

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "quota_exhausted", upgrade: true });
    expect(response.headers.get("retry-after")).not.toBeNull();
    expect(tts.calls).toHaveLength(0);
  });

  it("answers a quota store that could not count as a plain 503, with no upgrade prompt", async () => {
    state.plan = { plan: "plus", readable: true };
    state.quota = { allowed: false, refusal: "unavailable", resetAt: null } satisfies QuotaDecision;

    const response = await line();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("voice_unavailable");
    expect(body).not.toHaveProperty("upgrade");
    expect(tts.calls).toHaveLength(0);
  });

  it("offers a Premium learner no upgrade when their voice lines are spent", async () => {
    state.plan = { plan: "premium", readable: true };
    state.quota = { allowed: false, refusal: "quota_exhausted", resetAt: RESET } satisfies QuotaDecision;

    expect((await (await line()).json()).upgrade).toBe(false);
  });

  it("keeps the AI voice in the Trainer for Premium, counting nothing below it", async () => {
    // Plus has the AI voice in the conversation and the device's voice in the
    // Trainer (spec S2); the page falls back exactly as it does on Free.
    state.plan = { plan: "plus", readable: true };

    const response = await line({ text: "Was heißt der Bahnhof?", surface: "trainer" });

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: "plan_required", upgrade: true });
    expect(quotaCalls()).toEqual([]);
    expect(tts.calls).toHaveLength(0);
  });

  it("speaks in the Trainer for Premium, counting one voice line", async () => {
    state.plan = { plan: "premium", readable: true };

    const response = await line({ text: "Was heißt der Bahnhof?", surface: "trainer" });

    expect(response.status).toBe(200);
    expect(quotaCalls()).toEqual([`quota:premium:voice_lines:${HASH}`]);
  });

  it("counts nothing for a line that does not parse", async () => {
    state.plan = { plan: "plus", readable: true };

    expect((await line({ text: "" })).status).toBe(400);
    expect(quotaCalls()).toEqual([]);
  });
});
