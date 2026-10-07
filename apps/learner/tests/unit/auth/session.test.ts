import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();
const createServerClient = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...args),
}));

const { updateSession } = await import("@/lib/auth/session");

function requestFor(path: string) {
  return new NextRequest(new URL(`https://app.test${path}`));
}

/** Simulates Supabase writing a refreshed session cookie during getClaims. */
function clientThatSetsCookies(claims: unknown, cookiesToSet: unknown[] = []) {
  return (
    _url: string,
    _key: string,
    options: { cookies: { setAll(list: unknown[]): void } },
  ) => ({
    auth: {
      getClaims: vi.fn(async () => {
        options.cookies.setAll(cookiesToSet);
        return { data: claims, error: null };
      }),
    },
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc123def456");
  getClaims.mockReset();
  createServerClient.mockReset();
});

describe("unauthenticated visitor", () => {
  beforeEach(() => {
    createServerClient.mockImplementation(clientThatSetsCookies(null));
  });

  it("is redirected away from a protected page", async () => {
    const response = await updateSession(requestFor("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth/login");
  });

  it("is told where they were heading", async () => {
    const response = await updateSession(requestFor("/dashboard/progress"));

    expect(response.headers.get("location")).toContain(
      "next=%2Fdashboard%2Fprogress",
    );
  });

  it("remembers the query too, so a chosen plan survives sign-in", async () => {
    const response = await updateSession(requestFor("/billing/checkout?offer=dp_plus_month"));

    expect(response.headers.get("location")).toContain(
      `next=${encodeURIComponent("/billing/checkout?offer=dp_plus_month")}`,
    );
  });

  it("still matches protection on the path alone", async () => {
    // A query cannot make a public page protected, or a protected one public.
    const response = await updateSession(requestFor("/pricing?next=/dashboard"));

    expect(response.status).toBe(200);
  });

  it("passes through a public page untouched", async () => {
    const response = await updateSession(requestFor("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("reaches the sign-in page rather than being redirected to it forever", async () => {
    const response = await updateSession(requestFor("/auth/login"));

    expect(response.status).toBe(200);
  });
});

describe("a learner with a password but no second factor yet", () => {
  const claims = { claims: { sub: "11111111-1111-4111-8111-111111111111", aal: "aal1" } };

  beforeEach(() => {
    createServerClient.mockImplementation(clientThatSetsCookies(claims));
  });

  it("is sent to the authenticator from a protected page, remembering it", async () => {
    const response = await updateSession(requestFor("/billing/checkout?offer=dp_plus_month"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth/mfa?next=");
    expect(response.headers.get("location")).toContain(
      encodeURIComponent("/billing/checkout?offer=dp_plus_month"),
    );
  });

  it("is sent on from the sign-in page with the destination it was carrying", async () => {
    const response = await updateSession(requestFor("/auth/login?next=%2Fbilling"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth/mfa?next=%2Fbilling");
  });

  it("may stand on the step-up pages", async () => {
    expect((await updateSession(requestFor("/auth/mfa"))).status).toBe(200);
    expect((await updateSession(requestFor("/auth/mfa/enrol?next=%2Fchat"))).status).toBe(200);
  });

  it("may still browse the public pages", async () => {
    expect((await updateSession(requestFor("/pricing"))).status).toBe(200);
  });
});

describe("authenticated learner", () => {
  const claims = { claims: { sub: "11111111-1111-4111-8111-111111111111", aal: "aal2" } };

  beforeEach(() => {
    createServerClient.mockImplementation(clientThatSetsCookies(claims));
  });

  it("reaches a protected page", async () => {
    const response = await updateSession(requestFor("/dashboard"));

    expect(response.status).toBe(200);
  });

  it("is sent to the dashboard instead of the sign-in page", async () => {
    const response = await updateSession(requestFor("/auth/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/dashboard");
  });

  it("is sent where they were heading from the step-up pages, which have nothing more to ask", async () => {
    const response = await updateSession(requestFor("/auth/mfa?next=%2Fbilling%2Ftrial"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/\/billing\/trial$/);
  });

  it("can still reach the OAuth callback while signed in", async () => {
    const response = await updateSession(requestFor("/auth/callback"));

    expect(response.status).toBe(200);
  });
});

describe("session cookies", () => {
  const refreshed = [
    { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
  ];

  it("preserves a refreshed cookie on a pass-through response", async () => {
    createServerClient.mockImplementation(
      clientThatSetsCookies({ claims: { sub: "11111111-1111-4111-8111-111111111111", aal: "aal2" } }, refreshed),
    );

    const response = await updateSession(requestFor("/dashboard"));

    expect(response.status).toBe(200);
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });

  it("carries refreshed cookies onto a redirect response", async () => {
    // Dropping them here is the classic cause of learners being signed out at
    // random: the refreshed token is issued and then thrown away.
    createServerClient.mockImplementation(
      clientThatSetsCookies(null, refreshed),
    );

    const response = await updateSession(requestFor("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });

  it("refreshes the session even on a public page", async () => {
    // Otherwise a learner browsing public pages silently expires.
    const client = vi.fn(clientThatSetsCookies({ claims: { sub: "u1" } }, refreshed));
    createServerClient.mockImplementation(client);

    const response = await updateSession(requestFor("/"));

    expect(client).toHaveBeenCalled();
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });
});

describe("failure handling", () => {
  it("treats a claims lookup failure as unauthenticated, not as authenticated", async () => {
    createServerClient.mockImplementation(() => ({
      auth: {
        getClaims: vi.fn(async () => ({
          data: null,
          error: { message: "jwks unreachable" },
        })),
      },
    }));

    const response = await updateSession(requestFor("/dashboard"));

    expect(response.status).toBe(307);
  });

  it("fails closed if the auth client throws outright", async () => {
    createServerClient.mockImplementation(() => {
      throw new Error("boom");
    });

    const response = await updateSession(requestFor("/dashboard"));

    expect(response.status).toBe(307);
  });
});
