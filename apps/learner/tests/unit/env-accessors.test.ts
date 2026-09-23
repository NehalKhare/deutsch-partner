import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The accessors read the live process.env, so each test re-imports them with a
 * fresh module registry.
 */
async function loadServerEnv() {
  vi.resetModules();
  return import("@/lib/env/server");
}

async function loadClientEnv() {
  vi.resetModules();
  return import("@/lib/env/client");
}

describe("serverEnv", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  it("exposes the validated server environment", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key-value-long-enough");
    const { serverEnv } = await loadServerEnv();

    expect(serverEnv().OPENROUTER_API_KEY).toBe(
      "openrouter-key-value-long-enough",
    );
  });

  it("validates once and reuses the result", async () => {
    const { serverEnv } = await loadServerEnv();

    expect(serverEnv()).toBe(serverEnv());
  });

  it("throws on an invalid environment instead of returning a partial object", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    const { serverEnv } = await loadServerEnv();

    expect(() => serverEnv()).toThrow();
  });
});

describe("clientEnv", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_abc123def456",
    );
  });

  it("exposes the public keys", async () => {
    const { clientEnv } = await loadClientEnv();

    expect(clientEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(
      "https://project.supabase.co",
    );
  });

  it("exposes nothing beyond the public keys", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_DO-NOT-LEAK-me");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key-value-long-enough");
    const { clientEnv } = await loadClientEnv();

    const serialised = JSON.stringify(clientEnv());
    expect(serialised).not.toContain("sb_secret_DO-NOT-LEAK-me");
    expect(serialised).not.toContain("openrouter-key-value-long-enough");

    for (const key of Object.keys(clientEnv())) {
      expect(key.startsWith("NEXT_PUBLIC_")).toBe(true);
    }
  });

  it("fails when a required public value is missing, in any mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { clientEnv } = await loadClientEnv();

    expect(() => clientEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
