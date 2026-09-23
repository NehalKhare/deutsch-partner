import { beforeEach, describe, expect, it, vi } from "vitest";

const getStatus = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: async () => ({}),
}));
vi.mock("@dp/db/onboarding-repository", () => ({
  createOnboardingRepository: () => ({ getStatus }),
}));

const { requireOnboarded, redirectIfOnboarded } = await import(
  "@/lib/onboarding/gate"
);

const LEARNER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  getStatus.mockReset();
  redirect.mockClear();
});

describe("requireOnboarded", () => {
  it("lets an onboarded learner through", async () => {
    getStatus.mockResolvedValue({ ok: true, data: { onboarded: true } });

    await expect(requireOnboarded(LEARNER)).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a learner who has not onboarded to the onboarding page", async () => {
    getStatus.mockResolvedValue({ ok: true, data: { onboarded: false } });

    await expect(requireOnboarded(LEARNER)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/onboarding");
  });

  it("sends the learner to onboarding when the status cannot be read", async () => {
    // Showing a dashboard built from state we could not load is worse than
    // asking the learner to confirm their setup.
    getStatus.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });

    await expect(requireOnboarded(LEARNER)).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("redirectIfOnboarded", () => {
  it("sends a finished learner to the dashboard", async () => {
    getStatus.mockResolvedValue({ ok: true, data: { onboarded: true } });

    await expect(redirectIfOnboarded(LEARNER)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("leaves a learner who still needs onboarding where they are", async () => {
    getStatus.mockResolvedValue({ ok: true, data: { onboarded: false } });

    await expect(redirectIfOnboarded(LEARNER)).resolves.toBeUndefined();
  });

  it("leaves the learner on the form when the status cannot be read", async () => {
    // The mirror of the rule above: never bounce someone away from the one
    // page that could fix their state.
    getStatus.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });

    await expect(redirectIfOnboarded(LEARNER)).resolves.toBeUndefined();
  });
});
