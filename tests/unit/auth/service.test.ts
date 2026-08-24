import { describe, expect, it, vi } from "vitest";

import { createAuthService, type AuthClient } from "@/lib/auth/service";

const CREDENTIALS = {
  email: "lernerin@example.com",
  password: "korrekt-pferd-42",
};

function fakeAuth(overrides: Record<string, unknown> = {}) {
  const client = {
    auth: {
      signUp: vi.fn(async () => ({
        data: { user: { id: "u1" }, session: null },
        error: null,
      })),
      signInWithPassword: vi.fn(async () => ({
        data: { user: { id: "u1" }, session: { access_token: "t" } },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
  };

  return client as typeof client & AuthClient;
}

describe("signUp", () => {
  it("creates the account and reports that confirmation is pending", async () => {
    const client = fakeAuth();

    const result = await createAuthService(client).signUp(CREDENTIALS);

    expect(result).toEqual({
      ok: true,
      data: { needsEmailConfirmation: true },
    });
  });

  it("reports no confirmation needed when a session comes back immediately", async () => {
    const client = fakeAuth({
      signUp: vi.fn(async () => ({
        data: { user: { id: "u1" }, session: { access_token: "t" } },
        error: null,
      })),
    });

    const result = await createAuthService(client).signUp(CREDENTIALS);

    expect(result).toMatchObject({ data: { needsEmailConfirmation: false } });
  });

  it("validates before calling the auth provider", async () => {
    const client = fakeAuth();

    const result = await createAuthService(client).signUp({
      email: "nope",
      password: "short",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("does not reveal that an email is already registered", async () => {
    // Telling an attacker which addresses have accounts is user enumeration.
    const client = fakeAuth({
      signUp: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { code: "user_already_exists", message: "User already registered" },
      })),
    });

    const result = await createAuthService(client).signUp(CREDENTIALS);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/already/i);
  });

  it("still surfaces a genuine failure", async () => {
    const client = fakeAuth({
      signUp: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { code: "over_email_send_rate_limit", message: "slow down" },
      })),
    });

    const result = await createAuthService(client).signUp(CREDENTIALS);

    expect(result).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });
});

describe("signIn", () => {
  it("returns the authenticated user id", async () => {
    const result = await createAuthService(fakeAuth()).signIn(CREDENTIALS);

    expect(result).toEqual({ ok: true, data: { userId: "u1" } });
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const unknown = createAuthService(
      fakeAuth({
        signInWithPassword: vi.fn(async () => ({
          data: { user: null, session: null },
          error: { code: "invalid_credentials", message: "Invalid login credentials" },
        })),
      }),
    );

    const result = await unknown.signIn(CREDENTIALS);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_credentials" },
    });
    expect(JSON.stringify(result)).not.toMatch(/not found|no user|unknown/i);
  });

  it("reports an unconfirmed email distinctly, since the learner can act on it", async () => {
    const service = createAuthService(
      fakeAuth({
        signInWithPassword: vi.fn(async () => ({
          data: { user: null, session: null },
          error: { code: "email_not_confirmed", message: "Email not confirmed" },
        })),
      }),
    );

    expect(await service.signIn(CREDENTIALS)).toMatchObject({
      ok: false,
      error: { code: "email_not_confirmed" },
    });
  });

  it("never puts the provider's message into the result", async () => {
    const service = createAuthService(
      fakeAuth({
        signInWithPassword: vi.fn(async () => ({
          data: { user: null, session: null },
          error: {
            code: "unexpected_failure",
            message: "gotrue: pq: relation auth.internal does not exist",
          },
        })),
      }),
    );

    const result = await service.signIn(CREDENTIALS);

    expect(JSON.stringify(result)).not.toContain("auth.internal");
  });

  it("never echoes the submitted password", async () => {
    const service = createAuthService(
      fakeAuth({
        signInWithPassword: vi.fn(async () => ({
          data: { user: null, session: null },
          error: { code: "invalid_credentials", message: "bad" },
        })),
      }),
    );

    const result = await service.signIn(CREDENTIALS);

    expect(JSON.stringify(result)).not.toContain(CREDENTIALS.password);
  });
});

describe("signOut", () => {
  it("succeeds", async () => {
    expect(await createAuthService(fakeAuth()).signOut()).toEqual({
      ok: true,
      data: null,
    });
  });

  it("reports success even when the provider errors, so the learner is not stuck", async () => {
    // The cookie is cleared regardless; leaving someone unable to sign out is
    // worse than a silent provider hiccup.
    const service = createAuthService(
      fakeAuth({
        signOut: vi.fn(async () => ({ error: { code: "unexpected_failure", message: "x" } })),
      }),
    );

    expect(await service.signOut()).toMatchObject({ ok: true });
  });
});
