import { beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_ONBOARDING_STATE } from "@/lib/onboarding/form-state";

/**
 * Finishing onboarding with a destination: the plan a visitor chose before
 * the account existed is where they land once it is set up.
 */

const complete = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/auth/current-user", () => ({ requireAuthenticatedUserId: async () => "learner" }));
vi.mock("@/lib/supabase/server-client", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@dp/db/onboarding-repository", () => ({ createOnboardingRepository: () => ({ complete }) }));
vi.mock("@dp/domain/onboarding/input", () => ({
  parseOnboardingForm: () => ({ success: true, data: {} }),
}));

const { completeOnboardingAction } = await import("@/app/onboarding/actions");

function form(next?: string): FormData {
  const data = new FormData();
  if (next !== undefined) data.set("next", next);
  return data;
}

beforeEach(() => {
  complete.mockReset().mockResolvedValue({ ok: true, data: undefined });
  redirect.mockClear();
});

describe("completeOnboardingAction", () => {
  it("goes to the dashboard by default", async () => {
    await expect(completeOnboardingAction(INITIAL_ONBOARDING_STATE, form())).rejects.toThrow(
      "NEXT_REDIRECT /dashboard",
    );
  });

  it("goes where the learner was heading", async () => {
    await expect(
      completeOnboardingAction(INITIAL_ONBOARDING_STATE, form("/billing/checkout?offer=dp_plus_month")),
    ).rejects.toThrow("NEXT_REDIRECT /billing/checkout?offer=dp_plus_month");
  });

  it("never leaves the site", async () => {
    await expect(completeOnboardingAction(INITIAL_ONBOARDING_STATE, form("https://evil.example"))).rejects.toThrow(
      "NEXT_REDIRECT /dashboard",
    );
  });

  it.each(["/\t/evil.example", "/\n/evil.example", "/\r/evil.example"])(
    "never leaves the site through a control character (%j)",
    async (next) => {
      await expect(completeOnboardingAction(INITIAL_ONBOARDING_STATE, form(next))).rejects.toThrow(
        "NEXT_REDIRECT /dashboard",
      );
    },
  );
});
