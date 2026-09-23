import { describe, expect, it, vi } from "vitest";

import type { OnboardingInput } from "@dp/domain/onboarding/input";
import { createOnboardingRepository } from "../src/onboarding-repository";

const LEARNER = "11111111-1111-4111-8111-111111111111";

const INPUT = {
  nativeLanguage: "en",
  learningGoal: "Hold a conversation on holiday in Berlin",
  selectedLevel: "A2",
  targetTopics: ["travel"],
  interests: ["cycling"],
  inputPreference: "text",
  outputPreference: "text",
  correctionPreference: "gentle",
} satisfies OnboardingInput;

function fakeClient(options: {
  rpcError?: { code: string; message: string } | null;
  statusRow?: unknown;
  statusError?: { code: string; message: string } | null;
}) {
  const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({
    data: null,
    error: options.rpcError ?? null,
  }));

  const maybeSingle = vi.fn(async () => ({
    data: options.statusRow ?? null,
    error: options.statusError ?? null,
  }));

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: options.statusRow ?? null, error: null }).then(resolve),
  };

  return { client: { from: vi.fn(() => builder), rpc } as never, rpc, builder };
}

describe("completeOnboarding", () => {
  it("calls the database function with prefixed argument names", async () => {
    const fake = fakeClient({});

    const result = await createOnboardingRepository(fake.client).complete(INPUT);

    expect(result.ok).toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith("complete_onboarding", {
      p_native_language: "en",
      p_learning_goal: "Hold a conversation on holiday in Berlin",
      p_selected_level: "A2",
      p_target_topics: ["travel"],
      p_interests: ["cycling"],
      p_input_preference: "text",
      p_output_preference: "text",
      p_correction_preference: "gentle",
    });
  });

  it("never sends a learner id, because the function derives it", async () => {
    const fake = fakeClient({});

    await createOnboardingRepository(fake.client).complete(INPUT);

    const args = fake.rpc.mock.calls[0]?.[1] ?? {};
    expect(Object.keys(args).join(" ")).not.toMatch(/learner|user|id/i);
  });

  it("validates before calling the database", async () => {
    const fake = fakeClient({});

    const result = await createOnboardingRepository(fake.client).complete({
      ...INPUT,
      selectedLevel: "C1",
    } as never);

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("maps a denied call to forbidden", async () => {
    const fake = fakeClient({
      rpcError: { code: "42501", message: "onboarding requires a session" },
    });

    const result = await createOnboardingRepository(fake.client).complete(INPUT);

    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });

  it("does not leak the database message", async () => {
    const fake = fakeClient({
      rpcError: {
        code: "P0001",
        message: 'function public.complete_onboarding_v2 does not exist',
      },
    });

    const result = await createOnboardingRepository(fake.client).complete(INPUT);

    expect(JSON.stringify(result)).not.toContain("complete_onboarding_v2");
  });
});

describe("getStatus", () => {
  it("reports a learner with no profile as needing onboarding", async () => {
    const fake = fakeClient({ statusRow: null });

    const result = await createOnboardingRepository(fake.client).getStatus(LEARNER);

    expect(result).toEqual({ ok: true, data: { onboarded: false } });
  });

  it("reports a profile with no completion timestamp as needing onboarding", async () => {
    const fake = fakeClient({ statusRow: { id: LEARNER, onboarded_at: null } });

    const result = await createOnboardingRepository(fake.client).getStatus(LEARNER);

    expect(result).toEqual({ ok: true, data: { onboarded: false } });
  });

  it("reports a completed profile as onboarded", async () => {
    const fake = fakeClient({
      statusRow: { id: LEARNER, onboarded_at: "2026-08-21T10:00:00.000Z" },
    });

    const result = await createOnboardingRepository(fake.client).getStatus(LEARNER);

    expect(result).toEqual({ ok: true, data: { onboarded: true } });
  });

  it("reads only the two columns it needs", async () => {
    const fake = fakeClient({ statusRow: null });

    await createOnboardingRepository(fake.client).getStatus(LEARNER);

    expect(fake.builder.select).toHaveBeenCalledWith("id, onboarded_at");
  });
});
