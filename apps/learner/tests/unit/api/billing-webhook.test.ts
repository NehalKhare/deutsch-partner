import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockBillingProvider, type MockBillingProvider } from "@dp/billing/mock";
import type { NormalizedSubscription } from "@dp/billing/provider";
import { createMemoryBillingStore, type MemoryBillingStore } from "@dp/billing/testing/memory-store";

import { handleBillingWebhook, type BillingWebhookDeps } from "@/lib/api/billing-webhook";

/**
 * POST /api/billing/webhook, below the framework.
 *
 * billing-and-plans-spec.md S8. The signature is the only authentication this
 * endpoint has, so it is checked before anything else happens — no claim in
 * the inbox, no read from Stripe, no log line carrying what arrived — and a
 * body that fails it gets a bare 400. What passes is applied by the billing
 * package, whose outcome decides the status Stripe sees.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-01T12:00:00Z");

let provider: MockBillingProvider;
let store: MemoryBillingStore;
const info = vi.fn();
const warn = vi.fn();

const deps = (): BillingWebhookDeps => ({
  provider,
  repo: store,
  logger: { debug: vi.fn(), info, warn, error: vi.fn() },
  now: () => NOW,
  pseudonymFor: () => "0123456789abcdef0123456789abcdef",
});

const subscription: NormalizedSubscription = {
  id: "sub_Plus1",
  customerId: "cus_Learner1",
  status: "active",
  price: { priceId: "price_plusmonth", lookupKey: "dp_plus_month", planCode: "plus", passDays: null },
  currentPeriodEnd: new Date("2026-11-01T12:00:00Z"),
  cancelAtPeriodEnd: false,
  trialEnd: null,
  canceledAt: null,
};

beforeEach(async () => {
  provider = createMockBillingProvider();
  store = createMemoryBillingStore();
  await store.saveCustomer(LEARNER, "cus_Learner1");
  provider.setSubscription(subscription);
  info.mockReset();
  warn.mockReset();
});

describe("a body whose signature does not verify", () => {
  it("is a bare 400, audited, with nothing claimed or read", async () => {
    const { body } = provider.sign({ id: "evt_1", type: "customer.subscription.created", subscriptionId: "sub_Plus1" });

    const result = await handleBillingWebhook({ body, signature: "mock=forged" }, deps());

    expect(result).toEqual({ status: 400 });
    expect(store.snapshot().events.size).toBe(0);
    expect(provider.calls.map((call) => call.method)).toEqual(["verifyWebhook"]);
    expect(warn).toHaveBeenCalledWith("billing.webhook_rejected", { audit: true, signed: true });
  });

  it("is a 400 when there is no signature header at all", async () => {
    const result = await handleBillingWebhook({ body: "{}", signature: null }, deps());

    expect(result).toEqual({ status: 400 });
    expect(warn).toHaveBeenCalledWith("billing.webhook_rejected", { audit: true, signed: false });
  });

  it("never logs what arrived", async () => {
    await handleBillingWebhook({ body: '{"customer_email":"someone@example.com"}', signature: "mock=forged" }, deps());

    expect(JSON.stringify(warn.mock.calls)).not.toContain("someone@example.com");
  });

  it("is a 400 when verification itself throws", async () => {
    provider.failWith("verifyWebhook", "stripe_unavailable");

    expect(await handleBillingWebhook({ body: "{}", signature: "t=1,v1=x" }, deps())).toEqual({ status: 400 });
  });
});

describe("a verified event", () => {
  it("is applied and answered 200", async () => {
    const { body, signature } = provider.sign({
      id: "evt_1",
      type: "customer.subscription.created",
      subscriptionId: "sub_Plus1",
    });

    const result = await handleBillingWebhook({ body, signature }, deps());

    expect(result).toEqual({ status: 200 });
    expect(store.snapshot().subscriptions.get("sub_Plus1")).toMatchObject({ learnerId: LEARNER, planCode: "plus" });
    expect(store.snapshot().events.get("evt_1")?.status).toBe("processed");
  });

  it("is answered 200 again when Stripe sends it twice, and applied once", async () => {
    const { body, signature } = provider.sign({
      id: "evt_1",
      type: "customer.subscription.created",
      subscriptionId: "sub_Plus1",
    });

    await handleBillingWebhook({ body, signature }, deps());
    const again = await handleBillingWebhook({ body, signature }, deps());

    expect(again).toEqual({ status: 200 });
    expect(provider.calls.filter((call) => call.method === "retrieveSubscription")).toHaveLength(1);
  });

  it("is a 500 when it cannot be recorded, so Stripe sends it again", async () => {
    store.failWith("claimEvent", "unavailable");
    const { body, signature } = provider.sign({ id: "evt_2", type: "invoice.paid", subscriptionId: "sub_Plus1" });

    expect(await handleBillingWebhook({ body, signature }, deps())).toEqual({ status: 500 });
  });

  it("is acknowledged when it is a type nobody handles", async () => {
    const { body, signature } = provider.sign({ id: "evt_3", type: "customer.created" });

    expect(await handleBillingWebhook({ body, signature }, deps())).toEqual({ status: 200 });
    expect(store.snapshot().events.get("evt_3")?.status).toBe("ignored");
  });
});
