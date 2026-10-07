import { beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_AUTH_STATE } from "@dp/auth/form-state";

/**
 * The password is the first of two steps. Where it leads depends on whether
 * the account has an authenticator yet, and the destination the learner was
 * carrying is handed on rather than reached.
 */

const signIn = vi.fn();
const listFactors = vi.fn();
const check = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: async () => ({ auth: { mfa: { listFactors } } }),
}));
vi.mock("@dp/auth/service", () => ({ createAuthService: () => ({ signIn }) }));
vi.mock("@/lib/api/rate-limit", () => ({ limiterFor: () => ({ check }) }));

const { signInAction } = await import("@/app/auth/actions");

const VERIFIED = { id: "f1", status: "verified", factor_type: "totp" };

function form(next?: string): FormData {
  const data = new FormData();
  data.set("email", "learner@example.com");
  data.set("password", "correct horse battery");
  if (next !== undefined) data.set("next", next);
  return data;
}

beforeEach(() => {
  signIn.mockReset().mockResolvedValue({ ok: true, data: { userId: "u1" } });
  listFactors.mockReset().mockResolvedValue({ data: { totp: [VERIFIED] }, error: null });
  check.mockReset().mockResolvedValue({ allowed: true });
  redirect.mockClear();
});

describe("signInAction", () => {
  it("sends an account with an authenticator to answer it", async () => {
    await expect(signInAction(INITIAL_AUTH_STATE, form())).rejects.toThrow("NEXT_REDIRECT /auth/mfa");
  });

  it("sends an account without one to set it up, keeping the destination", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });

    await expect(signInAction(INITIAL_AUTH_STATE, form("/billing/trial"))).rejects.toThrow(
      "NEXT_REDIRECT /auth/mfa/enrol?next=%2Fbilling%2Ftrial",
    );
  });

  it("carries the destination to the authenticator too", async () => {
    await expect(signInAction(INITIAL_AUTH_STATE, form("/chat"))).rejects.toThrow(
      "NEXT_REDIRECT /auth/mfa?next=%2Fchat",
    );
  });

  it("drops a destination that could leave the site", async () => {
    await expect(signInAction(INITIAL_AUTH_STATE, form("//evil.example"))).rejects.toThrow(
      "NEXT_REDIRECT /auth/mfa",
    );
  });

  it("reports a wrong password and goes nowhere", async () => {
    signIn.mockResolvedValue({ ok: false, error: { message: "That email and password did not work." } });

    const state = await signInAction(INITIAL_AUTH_STATE, form());

    expect(state).toEqual({ status: "error", message: "That email and password did not work." });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuses to try the password once the address has had its attempts", async () => {
    check.mockResolvedValue({ allowed: false });

    const state = await signInAction(INITIAL_AUTH_STATE, form());

    expect(state.status).toBe("error");
    expect(state.message).toMatch(/too many attempts/i);
    expect(signIn).not.toHaveBeenCalled();
  });
});
