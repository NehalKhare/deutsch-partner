import Stripe from "stripe";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import { STRIPE_API_VERSION, stripeWire } from "../src/stripe-provider";

/**
 * The fields the provider reads, held against the SDK's own types.
 *
 * Each wire schema names only what the provider acts on. These assertions
 * are checked by `tsc`, not at run time: if an SDK upgrade moves or retypes a
 * field the provider reads — as 2025's basil release moved current_period_end
 * from the subscription onto its items — typecheck fails here, before a
 * webhook quietly reads undefined in production.
 */

describe("the API version", () => {
  it("is the one these shapes were checked against", () => {
    // Changing it is re-reading node_modules/stripe/esm/resources/*.d.ts for
    // every field below, then changing this.
    expect(Stripe.API_VERSION).toBe(STRIPE_API_VERSION);
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
  });
});

describe("what the SDK returns fits what the provider reads", () => {
  it("for a subscription, whose period lives on its items", () => {
    expectTypeOf<Stripe.Subscription>().toExtend<z.input<typeof stripeWire.subscription>>();
    expectTypeOf<Stripe.SubscriptionItem>().toHaveProperty("current_period_end").toEqualTypeOf<number>();
  });

  it("for a Checkout Session with its line items expanded", () => {
    expectTypeOf<Stripe.Checkout.Session>().toExtend<z.input<typeof stripeWire.checkoutSession>>();
  });

  it("for a price, with its currency options", () => {
    expectTypeOf<Stripe.Price>().toExtend<z.input<typeof stripeWire.price>>();
  });

  it("for a charge", () => {
    expectTypeOf<Stripe.Charge>().toExtend<z.input<typeof stripeWire.charge>>();
  });

  it("for an invoice, whose subscription is under its parent", () => {
    expectTypeOf<Stripe.Invoice>().toExtend<z.input<typeof stripeWire.invoice>>();
  });

  it("for every event the SDK can construct", () => {
    expectTypeOf<Stripe.Event>().toExtend<z.input<typeof stripeWire.event>>();
  });

  it("for the objects that are only read for their id", () => {
    expectTypeOf<Stripe.Customer>().toExtend<z.input<typeof stripeWire.customer>>();
    expectTypeOf<Stripe.BillingPortal.Session>().toExtend<z.input<typeof stripeWire.portalSession>>();
  });
});
