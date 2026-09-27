import { beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_BILLING_STATE } from "@/lib/billing/form-state";

/**
 * The three billing Server Actions.
 *
 * The rules live in lib/billing/orders.ts and are tested there. What is left
 * to test here is the framing: the learner comes from the verified session,
 * the form's fields reach the handler as they were posted, success leaves for
 * Stripe, a refusal becomes words on the form, and a learner who already
 * subscribes is sent where plans are changed.
 */

const requireAuthenticatedUserId = vi.fn();
const pseudonymFor = vi.fn();
const placeOrder = vi.fn();
const startTrial = vi.fn();
const openPortal = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/auth/current-user", () => ({
  requireAuthenticatedUserId: () => requireAuthenticatedUserId(),
}));
vi.mock("@/lib/api/composition", () => ({
  pseudonymFor: (id: string) => pseudonymFor(id),
  createBillingGraph: async () => ({ graph: true }),
}));
vi.mock("@/lib/api/rate-limit", () => ({ limiterFor: (scope: string) => ({ scope }) }));
vi.mock("@/lib/billing/orders", () => ({
  placeOrder: (...args: unknown[]) => placeOrder(...args),
  startTrial: (...args: unknown[]) => startTrial(...args),
  openPortal: (...args: unknown[]) => openPortal(...args),
}));

const { openPortalAction, placeOrderAction, startTrialAction } = await import("@/app/(app)/billing/actions");

const LEARNER = "11111111-1111-4111-8111-111111111111";
const HASH = "0123456789abcdef0123456789abcdef";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  requireAuthenticatedUserId.mockReset().mockResolvedValue(LEARNER);
  pseudonymFor.mockReset().mockReturnValue(HASH);
  placeOrder.mockReset();
  startTrial.mockReset();
  openPortal.mockReset();
  redirect.mockClear();
});

describe("placeOrderAction", () => {
  it("hands the posted fields and the session's learner to the order, then leaves for Stripe", async () => {
    placeOrder.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_1" });

    await expect(
      placeOrderAction(INITIAL_BILLING_STATE, form({ offer: "dp_plus_month", consent: "on", shownAmountMinor: "999" })),
    ).rejects.toThrow("NEXT_REDIRECT https://checkout.stripe.com/c/pay/cs_test_1");

    const [fields, identity, deps] = placeOrder.mock.calls[0]!;
    expect(fields).toEqual({ offer: "dp_plus_month", consent: "on", shownAmountMinor: "999" });
    expect(identity).toEqual({ learnerId: LEARNER, userIdHash: HASH });
    expect(deps).toMatchObject({ graph: true, limiter: { scope: "billing" }, trialLimiter: { scope: "billing_trial" } });
  });

  it("never reads a learner id from the form", async () => {
    placeOrder.mockResolvedValue({ ok: false, error: "invalid_offer" });

    await placeOrderAction(INITIAL_BILLING_STATE, form({ offer: "dp_plus_month", learnerId: "someone-else" }));

    expect(placeOrder.mock.calls[0]![1]).toEqual({ learnerId: LEARNER, userIdHash: HASH });
  });

  it("turns a refusal into words on the form", async () => {
    placeOrder.mockResolvedValue({ ok: false, error: "consent_required" });

    const state = await placeOrderAction(INITIAL_BILLING_STATE, form({ offer: "dp_plus_month" }));

    expect(state).toEqual({ status: "error", message: expect.stringMatching(/tick the box/i) });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a subscriber to Plan & billing, where plans are changed", async () => {
    placeOrder.mockResolvedValue({ ok: false, error: "already_subscribed" });

    await expect(placeOrderAction(INITIAL_BILLING_STATE, form({ offer: "dp_premium_month" }))).rejects.toThrow(
      "NEXT_REDIRECT /billing",
    );
  });

  it("refuses rather than rate-limit everyone as one learner when there is no pseudonym", async () => {
    pseudonymFor.mockImplementation(() => {
      throw new Error("LOG_PSEUDONYM_SALT is required");
    });

    const state = await placeOrderAction(INITIAL_BILLING_STATE, form({ offer: "dp_plus_month", consent: "on" }));

    expect(state.status).toBe("error");
    expect(placeOrder).not.toHaveBeenCalled();
  });
});

describe("startTrialAction", () => {
  it("starts the trial for the session's learner and leaves for Stripe", async () => {
    startTrial.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_2" });

    await expect(startTrialAction(INITIAL_BILLING_STATE, form({}))).rejects.toThrow(
      "NEXT_REDIRECT https://checkout.stripe.com/c/pay/cs_test_2",
    );
    expect(startTrial.mock.calls[0]![0]).toEqual({ learnerId: LEARNER, userIdHash: HASH });
  });

  it("says when the trial has been used", async () => {
    startTrial.mockResolvedValue({ ok: false, error: "trial_used" });

    expect(await startTrialAction(INITIAL_BILLING_STATE, form({}))).toEqual({
      status: "error",
      message: expect.stringMatching(/already been used/i),
    });
  });
});

describe("openPortalAction", () => {
  it("opens the portal and leaves for it", async () => {
    openPortal.mockResolvedValue({ ok: true, url: "https://billing.stripe.com/p/session/x" });

    await expect(openPortalAction(INITIAL_BILLING_STATE, form({}))).rejects.toThrow(
      "NEXT_REDIRECT https://billing.stripe.com/p/session/x",
    );
  });

  it("says there is nothing to manage before a purchase", async () => {
    openPortal.mockResolvedValue({ ok: false, error: "no_customer" });

    expect((await openPortalAction(INITIAL_BILLING_STATE, form({}))).message).toMatch(/nothing to manage/i);
  });
});
