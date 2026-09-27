import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The billing half of the composition root: payments are on exactly when a
 * Stripe key is configured, and the logger the public pages fall back on
 * can never be the thing that breaks them.
 */

const env = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock("@/lib/env/server", () => ({
  serverEnv: () => {
    if (env.current === null) throw new Error("OPENROUTER_API_KEY: is required in production");
    return env.current;
  },
}));

const { billingLogger, createBillingProviderOrNull, paymentsEnabled } = await import("@/lib/api/composition");

beforeEach(() => {
  env.current = { NODE_ENV: "test", STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined };
});

describe("payments", () => {
  it("are off, with no provider, when no Stripe key is configured", () => {
    expect(paymentsEnabled()).toBe(false);
    expect(createBillingProviderOrNull()).toBeNull();
  });

  it("are on when a key and its webhook secret are configured", () => {
    env.current = { NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test_abc123", STRIPE_WEBHOOK_SECRET: "whsec_abc123" };

    expect(paymentsEnabled()).toBe(true);
    const provider = createBillingProviderOrNull();
    expect(provider).not.toBeNull();
    expect(typeof provider?.verifyWebhook).toBe("function");
  });
});

describe("billingLogger", () => {
  it("still logs where the environment is incomplete, as a public page's may be", () => {
    env.current = null;

    const logger = billingLogger();
    expect(() => logger.warn("billing.prices_unavailable", { kind: "thrown" })).not.toThrow();
  });
});
