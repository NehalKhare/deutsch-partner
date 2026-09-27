import { beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_AUTH_STATE } from "@dp/auth/form-state";

/**
 * Signing up with somewhere to go afterwards.
 *
 * A visitor who pressed "Choose Plus" on the pricing page arrives here with
 * the order page as `next`. A new account has to be set up before it can
 * reach any room, so the destination is carried through onboarding rather
 * than dropped at it — and it is only ever a same-site path.
 */

const signUp = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/supabase/server-client", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@dp/auth/service", () => ({ createAuthService: () => ({ signUp }) }));

const { signUpAction } = await import("@/app/auth/actions");

function form(next?: string): FormData {
  const data = new FormData();
  data.set("email", "learner@example.com");
  data.set("password", "correct horse battery");
  data.set("confirmPassword", "correct horse battery");
  if (next !== undefined) data.set("next", next);
  return data;
}

beforeEach(() => {
  signUp.mockReset().mockResolvedValue({ ok: true, data: { needsEmailConfirmation: false } });
  redirect.mockClear();
});

describe("signUpAction", () => {
  it("goes to the dashboard when there is nowhere else to go", async () => {
    await expect(signUpAction(INITIAL_AUTH_STATE, form())).rejects.toThrow("NEXT_REDIRECT /dashboard");
  });

  it("carries a destination through onboarding", async () => {
    const next = "/billing/checkout?offer=dp_plus_month";

    await expect(signUpAction(INITIAL_AUTH_STATE, form(next))).rejects.toThrow(
      `NEXT_REDIRECT /onboarding?next=${encodeURIComponent(next)}`,
    );
  });

  it("drops a destination that could leave the site", async () => {
    await expect(signUpAction(INITIAL_AUTH_STATE, form("//evil.example/steal"))).rejects.toThrow(
      "NEXT_REDIRECT /dashboard",
    );
  });

  it("drops a destination that hides a second slash behind a tab", async () => {
    // "/\t/evil.example" becomes "//evil.example" once a browser parses it.
    await expect(signUpAction(INITIAL_AUTH_STATE, form("/\t/evil.example"))).rejects.toThrow(
      "NEXT_REDIRECT /dashboard",
    );
  });

  it("asks for the email to be confirmed before going anywhere", async () => {
    signUp.mockResolvedValue({ ok: true, data: { needsEmailConfirmation: true } });

    const state = await signUpAction(INITIAL_AUTH_STATE, form("/billing/trial"));

    expect(state.status).toBe("check_email");
    expect(redirect).not.toHaveBeenCalled();
  });
});
