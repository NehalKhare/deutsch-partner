import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims } }),
}));

const {
  getAuthenticatedAccount,
  getAuthenticatedUserId,
  getSessionClaims,
  requireAuthenticatedAccount,
  requireAuthenticatedUserId,
} = await import("@/lib/auth/current-user");

const LEARNER = "11111111-1111-4111-8111-111111111111";

/** A session that has answered its authenticator, which is what every room needs. */
function verified(extra: Record<string, unknown> = {}) {
  return { data: { claims: { sub: LEARNER, aal: "aal2", ...extra } }, error: null };
}

beforeEach(() => {
  getClaims.mockReset();
  redirect.mockClear();
});

describe("getAuthenticatedUserId", () => {
  it("returns the subject claim for a signed-in learner", async () => {
    getClaims.mockResolvedValue(verified());

    expect(await getAuthenticatedUserId()).toBe(LEARNER);
  });

  it("returns null for a password without its second factor", async () => {
    // Every page, action and route handler reads its learner through here, so
    // this one null is what keeps a half-signed-in session out of /api/chat.
    getClaims.mockResolvedValue({ data: { claims: { sub: LEARNER, aal: "aal1" } }, error: null });

    expect(await getAuthenticatedUserId()).toBeNull();
  });

  it("treats a token with no assurance claim as a password alone", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: LEARNER } }, error: null });

    expect(await getAuthenticatedUserId()).toBeNull();
  });

  it("returns null when there is no session", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    expect(await getAuthenticatedUserId()).toBeNull();
  });

  it("returns null when verification fails, rather than trusting the token", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "bad signature" } });

    expect(await getAuthenticatedUserId()).toBeNull();
  });

  it("rejects a subject claim that is not a uuid", async () => {
    // The claim decides which learner's rows we read. It has to be the shape
    // the database expects, not merely present.
    getClaims.mockResolvedValue({ data: { claims: { sub: "admin", aal: "aal2" } }, error: null });

    expect(await getAuthenticatedUserId()).toBeNull();
  });

  it("returns null when the claims object has no subject at all", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });

    expect(await getAuthenticatedUserId()).toBeNull();
  });

  it("fails closed if the auth call throws", async () => {
    getClaims.mockRejectedValue(new Error("network"));

    expect(await getAuthenticatedUserId()).toBeNull();
  });
});

describe("requireAuthenticatedUserId", () => {
  it("returns the id when signed in", async () => {
    getClaims.mockResolvedValue(verified());

    expect(await requireAuthenticatedUserId()).toBe(LEARNER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a password-only session to its authenticator, not to sign in again", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: LEARNER, aal: "aal1" } }, error: null });

    await expect(requireAuthenticatedUserId()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/auth/mfa");
  });

  it("redirects to sign-in when there is no session", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    await expect(requireAuthenticatedUserId()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });

  it("never returns a value when unauthenticated", async () => {
    // A helper that returned undefined instead of redirecting would hand a
    // page an empty learner id and let it query with it.
    getClaims.mockResolvedValue({ data: null, error: null });

    await expect(requireAuthenticatedUserId()).rejects.toThrow();
  });
});


describe("getAuthenticatedAccount", () => {
  it("returns the address alongside the id", async () => {
    // The shell shows it back, and reading both from the same verified claim
    // is what stops the name in the header disagreeing with whose rows are
    // being read underneath it.
    getClaims.mockResolvedValue(verified({ email: "learner@example.com" }));

    expect(await getAuthenticatedAccount()).toEqual({
      id: LEARNER,
      email: "learner@example.com",
    });
  });

  it("returns a null address when the token carries none", async () => {
    // Not every sign-in method has one, and the shell still has to render.
    getClaims.mockResolvedValue(verified());

    expect(await getAuthenticatedAccount()).toEqual({ id: LEARNER, email: null });
  });

  it("ignores an address that is not one, rather than showing it", async () => {
    getClaims.mockResolvedValue(verified({ email: 42 }));

    expect(await getAuthenticatedAccount()).toEqual({ id: LEARNER, email: null });
  });

  it("returns null when the token has no usable subject", async () => {
    // An address without a verified subject is not a session.
    getClaims.mockResolvedValue({
      data: { claims: { email: "learner@example.com", aal: "aal2" } },
      error: null,
    });

    expect(await getAuthenticatedAccount()).toBeNull();
  });

  it("returns null when verification fails, whatever the claims said", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: LEARNER, email: "learner@example.com", aal: "aal2" } },
      error: { message: "bad signature" },
    });

    expect(await getAuthenticatedAccount()).toBeNull();
  });

  it("returns null for a password without its second factor", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: LEARNER, email: "learner@example.com", aal: "aal1" } },
      error: null,
    });

    expect(await getAuthenticatedAccount()).toBeNull();
  });
});

describe("requireAuthenticatedAccount", () => {
  it("returns the account once both factors are present", async () => {
    getClaims.mockResolvedValue(verified({ email: "learner@example.com" }));

    expect(await requireAuthenticatedAccount()).toEqual({ id: LEARNER, email: "learner@example.com" });
  });

  it("redirects to sign-in with no session and to the authenticator with half of one", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(requireAuthenticatedAccount()).rejects.toThrow("NEXT_REDIRECT:/auth/login");

    getClaims.mockResolvedValue({ data: { claims: { sub: LEARNER, aal: "aal1" } }, error: null });
    await expect(requireAuthenticatedAccount()).rejects.toThrow("NEXT_REDIRECT:/auth/mfa");
  });
});

describe("getSessionClaims", () => {
  it("is the one reader that hands back a password-only session, for the step-up pages", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: LEARNER, aal: "aal1" } }, error: null });

    expect(await getSessionClaims()).toEqual({ sub: LEARNER, email: null, aal: "aal1" });
  });

  it("is null without a session", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    expect(await getSessionClaims()).toBeNull();
  });
});
