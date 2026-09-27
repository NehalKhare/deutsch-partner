import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The onboarding page is reached by a plain GET link carrying `next`, and a
 * learner who has already finished is redirected straight to it. That makes
 * it the one place a crafted link could bounce a signed-in learner off-site
 * with a single click, so what reaches the redirect is pinned here.
 */

const redirectIfOnboarded = vi.fn(async (_learnerId: string, _destination?: string) => undefined);

vi.mock("@/lib/auth/current-user", () => ({ requireAuthenticatedUserId: async () => "learner" }));
vi.mock("@/lib/onboarding/gate", () => ({
  redirectIfOnboarded: (learnerId: string, destination?: string) => redirectIfOnboarded(learnerId, destination),
}));
vi.mock("@/app/onboarding/actions", () => ({ completeOnboardingAction: vi.fn() }));

const { default: OnboardingPage } = await import("@/app/onboarding/page");

function visit(next: string | string[] | undefined) {
  return OnboardingPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
}

beforeEach(() => {
  redirectIfOnboarded.mockClear();
});

describe("OnboardingPage", () => {
  it("sends a finished learner where they were heading", async () => {
    await visit("/billing/checkout?offer=dp_plus_month");

    expect(redirectIfOnboarded).toHaveBeenCalledWith("learner", "/billing/checkout?offer=dp_plus_month");
  });

  it("leaves the destination to the gate's default when none was given", async () => {
    await visit(undefined);

    expect(redirectIfOnboarded).toHaveBeenCalledWith("learner", undefined);
  });

  it.each(["/\t/evil.example", "/\n/evil.example", "//evil.example", "https://evil.example"])(
    "never hands the gate an off-site destination (%j)",
    async (next) => {
      await visit(next);

      expect(redirectIfOnboarded).toHaveBeenCalledWith("learner", "/dashboard");
    },
  );

  it("treats a repeated parameter as no destination rather than failing", async () => {
    await expect(visit(["/billing", "/dashboard"])).resolves.toBeDefined();

    expect(redirectIfOnboarded).toHaveBeenCalledWith("learner", undefined);
  });
});
