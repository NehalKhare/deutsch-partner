import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = {
  getAll: vi.fn(() => [{ name: "sb-access-token", value: "token" }]),
  set: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_abc123def456",
  );
});

describe("createBrowserSupabaseClient", () => {
  it("builds a client from the public environment", async () => {
    const { createBrowserSupabaseClient } = await import(
      "@/lib/supabase/browser-client"
    );
    const client = createBrowserSupabaseClient();

    expect(client.auth).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("fails when the public environment is incomplete", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { createBrowserSupabaseClient } = await import(
      "@/lib/supabase/browser-client"
    );

    expect(() => createBrowserSupabaseClient()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });
});

describe("createServerSupabaseClient", () => {
  it("builds a request-scoped client", async () => {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server-client"
    );
    const client = await createServerSupabaseClient();

    expect(typeof client.from).toBe("function");
  });
});

describe("createCookieAdapter", () => {
  it("reads through to the request cookie store", async () => {
    const { createCookieAdapter } = await import(
      "@/lib/supabase/server-client"
    );

    expect(createCookieAdapter(cookieStore).getAll()).toEqual([
      { name: "sb-access-token", value: "token" },
    ]);
  });

  it("writes refreshed session cookies back to the store", async () => {
    const { createCookieAdapter } = await import(
      "@/lib/supabase/server-client"
    );

    createCookieAdapter(cookieStore).setAll([
      { name: "sb-access-token", value: "refreshed", options: {} },
    ]);

    expect(cookieStore.set).toHaveBeenCalledWith(
      "sb-access-token",
      "refreshed",
      {},
    );
  });

  it("tolerates a read-only cookie store during a Server Component render", async () => {
    const readOnlyStore = {
      getAll: () => [],
      set: () => {
        throw new Error("Cookies can only be modified in a Server Action");
      },
    };
    const { createCookieAdapter } = await import(
      "@/lib/supabase/server-client"
    );

    expect(() =>
      createCookieAdapter(readOnlyStore).setAll([
        { name: "sb-access-token", value: "refreshed", options: {} },
      ]),
    ).not.toThrow();
  });
});

describe("createSecretKeySupabaseClient", () => {
  it("refuses to build without a secret key", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const { createSecretKeySupabaseClient } = await import(
      "@/lib/supabase/server-client"
    );

    expect(() => createSecretKeySupabaseClient()).toThrow(
      /SUPABASE_SECRET_KEY/,
    );
  });

  it("builds a client when the secret key is present", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_abc123def456");
    const { createSecretKeySupabaseClient } = await import(
      "@/lib/supabase/server-client"
    );

    expect(typeof createSecretKeySupabaseClient().from).toBe("function");
  });

  it("does not persist a session, because it is not acting for a user", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_abc123def456");
    const { secretKeyClientOptions } = await import(
      "@/lib/supabase/server-client"
    );

    expect(secretKeyClientOptions.auth).toMatchObject({
      persistSession: false,
      autoRefreshToken: false,
    });
  });
});
