import { describe, expect, it } from "vitest";

import { BillingProviderError } from "../src/errors";
import { createMockBillingProvider } from "../src/mock";

/**
 * The double the learner app's route and action tests will stand on. It has
 * to fail where Stripe's provider fails — on input Stripe would refuse, on a
 * signature it did not issue — or those tests prove less than they claim.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof BillingProviderError ? error.code : "not a billing error";
  }
}

describe("the mock provider", () => {
  it("verifies exactly what it signed", async () => {
    const provider = createMockBillingProvider();
    const { body, signature } = provider.sign({ id: "evt_1", type: "invoice.paid", subscriptionId: "sub_Alice1" });

    expect(await provider.verifyWebhook(body, signature)).toMatchObject({
      id: "evt_1",
      type: "invoice.paid",
      subscriptionId: "sub_Alice1",
    });
    expect(await provider.verifyWebhook(body.replace("invoice.paid", "charge.refunded"), signature)).toBeNull();
    expect(await provider.verifyWebhook(body, null)).toBeNull();
    expect(await provider.verifyWebhook(body, "mock=forged")).toBeNull();
  });

  it("does not verify another instance's signature", async () => {
    const { body, signature } = createMockBillingProvider().sign({ id: "evt_1", type: "invoice.paid" });

    expect(await createMockBillingProvider().verifyWebhook(body, signature)).toBeNull();
  });

  it("refuses what the Stripe provider refuses, before recording a result", async () => {
    const provider = createMockBillingProvider();

    expect(await codeOf(provider.createCustomer({ learnerId: "alice" }))).toBe("billing_invalid_input");
    expect(
      await codeOf(
        provider.createCheckoutSession({
          customerId: "cus_Alice",
          priceId: "price_PassPlus",
          mode: "payment",
          trial: { days: 7 },
          successUrl: "https://deutsch-partner.example/billing/success",
          cancelUrl: "https://deutsch-partner.example/pricing",
          automaticTax: false,
          clientReferenceId: "33333333-3333-4333-8333-333333333333",
          submitMessage: "Order placed.",
        }),
      ),
    ).toBe("billing_invalid_input");
  });

  it("hands out ids in Stripe's formats", async () => {
    const provider = createMockBillingProvider();

    const { customerId } = await provider.createCustomer({ learnerId: LEARNER });
    const session = await provider.createCheckoutSession({
      customerId,
      priceId: "price_PlusMonth",
      mode: "subscription",
      trial: null,
      successUrl: "https://deutsch-partner.example/billing/success",
      cancelUrl: "https://deutsch-partner.example/pricing",
      automaticTax: false,
      clientReferenceId: "33333333-3333-4333-8333-333333333333",
      submitMessage: "Order placed.",
    });

    expect(customerId).toMatch(/^cus_[A-Za-z0-9]+$/);
    expect(session.id).toMatch(/^cs_test_[A-Za-z0-9]+$/);
    expect(session.url).toMatch(/^https:\/\//);
    expect(provider.calls.map((call) => call.method)).toEqual(["createCustomer", "createCheckoutSession"]);
  });

  it("answers not found for an object nobody set", async () => {
    expect(await codeOf(createMockBillingProvider().retrieveSubscription("sub_Nobody"))).toBe("stripe_not_found");
  });

  it("fails as many times as it was told to, then recovers", async () => {
    const provider = createMockBillingProvider();
    provider.failWith("createPortalSession", "stripe_rate_limited", 2);
    const input = { customerId: "cus_Alice", returnUrl: "https://deutsch-partner.example/billing" };

    expect(await codeOf(provider.createPortalSession(input))).toBe("stripe_rate_limited");
    expect(await codeOf(provider.createPortalSession(input))).toBe("stripe_rate_limited");
    expect(await codeOf(provider.createPortalSession(input))).toBeUndefined();
  });
});
