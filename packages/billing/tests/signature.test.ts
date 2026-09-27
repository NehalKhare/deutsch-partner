import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { createStripeProvider } from "../src/stripe-provider";
import { stripeEvent, stripeInvoice, stripeSubscription } from "./support/stripe-objects";

/**
 * Signature verification with the real SDK and a real HMAC.
 *
 * The one check that authenticates the webhook (spec S8 step 1) is the SDK's
 * own, so it is tested through the SDK rather than through a double that
 * would agree with whatever it was told. The client is built with a test key
 * and never makes a request: constructing an event is local.
 */

const SECRET = "whsec_TestSigningSecretAbc123";
const provider = createStripeProvider({ secretKey: "sk_test_51AbcDEFghiJKLmno", webhookSecret: SECRET });

function signed(payload: string, options: { secret?: string; timestamp?: number } = {}) {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? SECRET,
    timestamp: options.timestamp,
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("a genuine Stripe event", () => {
  it("verifies, and comes back reduced to its id, type, time and object", async () => {
    const body = JSON.stringify(stripeEvent("customer.subscription.updated", stripeSubscription(), { id: "evt_Real1" }));

    const event = await provider.verifyWebhook(body, signed(body));

    expect(event).toMatchObject({
      id: "evt_Real1",
      type: "customer.subscription.updated",
      objectId: "sub_Alice1",
      subscriptionId: "sub_Alice1",
    });
    expect(event?.created).toBeInstanceOf(Date);
  });

  it("carries an invoice's subscription through verification", async () => {
    const body = JSON.stringify(stripeEvent("invoice.payment_failed", stripeInvoice(), { id: "evt_Real2" }));

    expect((await provider.verifyWebhook(body, signed(body)))?.subscriptionId).toBe("sub_Alice1");
  });
});

describe("anything else", () => {
  const body = JSON.stringify(stripeEvent("customer.subscription.updated", stripeSubscription(), { id: "evt_Real3" }));

  it("is refused when one byte of the body changed after signing", async () => {
    const header = signed(body);
    const tampered = body.replace('"status":"active"', '"status":"canceled"');

    expect(tampered).not.toBe(body);
    expect(await provider.verifyWebhook(tampered, header)).toBeNull();
  });

  it("is refused when it was signed with another endpoint's secret", async () => {
    expect(await provider.verifyWebhook(body, signed(body, { secret: "whsec_SomebodyElsesSecret1" }))).toBeNull();
  });

  it("is refused when the signature is older than the SDK's tolerance, so a captured event cannot be replayed", async () => {
    const stale = signed(body, { timestamp: nowSeconds() - 60 * 60 });

    expect(await provider.verifyWebhook(body, stale)).toBeNull();
  });

  it.each([
    ["no header at all", null],
    ["an empty header", ""],
    ["a header with no signature in it", `t=${Math.floor(Date.now() / 1000)}`],
    ["a header that is not Stripe's format", "sha256=abcdef"],
  ])("is refused with %s", async (_label, header) => {
    expect(await provider.verifyWebhook(body, header)).toBeNull();
  });

  it("is refused when the body is not an event, however well it is signed", async () => {
    const notAnEvent = JSON.stringify({ hello: "world" });

    expect(await provider.verifyWebhook(notAnEvent, signed(notAnEvent))).toBeNull();
  });
});
