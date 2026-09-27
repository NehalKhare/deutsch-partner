import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The operator app's boot guard. It reads the live process.env, so each test
 * re-imports it with a fresh module registry.
 */
async function loadServerEnv() {
  vi.resetModules();
  return import("@/lib/env/server");
}

describe("serverEnv in the operator app", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  it("boots without any of the keys it refuses", async () => {
    const { serverEnv } = await loadServerEnv();

    expect(() => serverEnv()).not.toThrow();
  });

  it.each([
    ["the model key", { OPENROUTER_API_KEY: "openrouter-key-value-long-enough" }],
    ["the repository token", { GITHUB_TOKEN: "github-token-long-enough", GITHUB_REPOSITORY: "owner/repo" }],
    [
      "the Stripe secret key",
      { STRIPE_SECRET_KEY: "sk_test_51AbcDEFghiJKLmno", STRIPE_WEBHOOK_SECRET: "whsec_AbcDEFghiJKLmno123" },
    ],
  ])("refuses to boot holding %s", async (_label, values) => {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    const { serverEnv } = await loadServerEnv();

    expect(() => serverEnv()).toThrow(/must not be set for the operator app/);
  });

  it("names both Stripe secrets among what it refuses, and never echoes their values", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_51AbcDEFghiJKLmno");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_AbcDEFghiJKLmno123");
    const { serverEnv, FORBIDDEN_IN_OPS } = await loadServerEnv();

    expect(FORBIDDEN_IN_OPS).toEqual(expect.arrayContaining(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]));
    try {
      serverEnv();
      expect.unreachable("expected serverEnv to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/STRIPE_SECRET_KEY/);
      expect(message).toMatch(/STRIPE_WEBHOOK_SECRET/);
      expect(message).not.toContain("sk_test_51AbcDEFghiJKLmno");
      expect(message).not.toContain("whsec_AbcDEFghiJKLmno123");
    }
  });
});
