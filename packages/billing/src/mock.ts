import { createHash } from "node:crypto";

import type { z } from "zod";

import { BillingProviderError, type BillingErrorCode } from "./errors";
import {
  chargeIdInput,
  checkoutSessionIdInput,
  checkoutSessionInputSchema,
  customerInputSchema,
  lookupKeysInput,
  portalSessionInputSchema,
  subscriptionIdInput,
  type BillingProvider,
  type NormalizedCharge,
  type NormalizedCheckout,
  type NormalizedPrice,
  type NormalizedSubscription,
  type VerifiedEvent,
} from "./provider";

/**
 * A BillingProvider that takes no money, for tests.
 *
 * It validates its inputs exactly as the Stripe provider does, so a test
 * that passes against it has sent something Stripe would accept. What the
 * retrieve methods return is scripted: a test sets the object "as Stripe says
 * it is now", which is the only thing the webhook ever reads. A signature is
 * one this instance issued for that exact body, so nothing arriving from
 * outside a test can verify.
 *
 * Reachable by tests only; a CI test keeps product code from importing it.
 */

export interface MockCall {
  readonly method: keyof BillingProvider;
  readonly input: unknown;
}

export interface MockBillingProvider extends BillingProvider {
  /** Every call that reached the provider, in order, inputs as given. */
  readonly calls: MockCall[];
  setSubscription(subscription: NormalizedSubscription): void;
  setCheckoutSession(session: NormalizedCheckout): void;
  setCharge(charge: NormalizedCharge): void;
  setPrices(prices: readonly NormalizedPrice[]): void;
  /** The next `times` calls to `method` reject with this code. */
  failWith(method: keyof BillingProvider, code: BillingErrorCode, times?: number): void;
  /** A raw body and a signature header that this provider, and only this one, verifies. */
  sign(event: Partial<VerifiedEvent> & Pick<VerifiedEvent, "id" | "type">): { body: string; signature: string };
}

function accept<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BillingProviderError("billing_invalid_input");
  return parsed.data;
}

export function createMockBillingProvider(): MockBillingProvider {
  const calls: MockCall[] = [];
  const subscriptions = new Map<string, NormalizedSubscription>();
  const sessions = new Map<string, NormalizedCheckout>();
  const charges = new Map<string, NormalizedCharge>();
  let prices: readonly NormalizedPrice[] = [];
  const failures = new Map<keyof BillingProvider, { code: BillingErrorCode; times: number }>();
  const signed = new Map<string, { signature: string; event: VerifiedEvent }>();
  let counter = 0;

  /** Records the call, then throws the scripted failure if there is one. */
  const enter = (method: keyof BillingProvider, input: unknown) => {
    calls.push({ method, input });
    const scripted = failures.get(method);
    if (scripted === undefined) return;
    if (scripted.times <= 1) failures.delete(method);
    else failures.set(method, { ...scripted, times: scripted.times - 1 });
    throw new BillingProviderError(scripted.code);
  };

  const found = <T>(value: T | undefined): T => {
    if (value === undefined) throw new BillingProviderError("stripe_not_found");
    return value;
  };

  return {
    calls,
    setSubscription: (subscription) => void subscriptions.set(subscription.id, subscription),
    setCheckoutSession: (session) => void sessions.set(session.id, session),
    setCharge: (charge) => void charges.set(charge.id, charge),
    setPrices: (next) => {
      prices = next;
    },
    failWith: (method, code, times = 1) => void failures.set(method, { code, times }),

    sign(partial) {
      const event: VerifiedEvent = {
        created: new Date(0),
        objectId: null,
        subscriptionId: null,
        ...partial,
      };
      const body = JSON.stringify({ ...event, created: event.created.toISOString() });
      const signature = `mock=${createHash("sha256").update(body).digest("hex")}`;
      signed.set(body, { signature, event });
      return { body, signature };
    },

    async createCustomer(input) {
      enter("createCustomer", input);
      accept(customerInputSchema, input);
      counter += 1;
      return { customerId: `cus_Mock${counter}` };
    },

    async createCheckoutSession(input) {
      enter("createCheckoutSession", input);
      accept(checkoutSessionInputSchema, input);
      counter += 1;
      const id = `cs_test_Mock${counter}`;
      return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
    },

    async createPortalSession(input) {
      enter("createPortalSession", input);
      accept(portalSessionInputSchema, input);
      return { url: "https://billing.stripe.com/p/session/mock" };
    },

    async verifyWebhook(rawBody, signature) {
      enter("verifyWebhook", { signed: signature !== null });
      if (!signature) return null;
      const issued = signed.get(rawBody);
      return issued !== undefined && issued.signature === signature ? issued.event : null;
    },

    async retrieveSubscription(id) {
      enter("retrieveSubscription", id);
      return found(subscriptions.get(accept(subscriptionIdInput, id)));
    },

    async cancelAtPeriodEnd(id) {
      enter("cancelAtPeriodEnd", id);
      const current = found(subscriptions.get(accept(subscriptionIdInput, id)));
      const updated = { ...current, cancelAtPeriodEnd: true };
      subscriptions.set(updated.id, updated);
      return updated;
    },

    async retrieveCheckoutSession(id) {
      enter("retrieveCheckoutSession", id);
      return found(sessions.get(accept(checkoutSessionIdInput, id)));
    },

    async retrieveCharge(id) {
      enter("retrieveCharge", id);
      return found(charges.get(accept(chargeIdInput, id)));
    },

    async listPrices(lookupKeys) {
      enter("listPrices", [...lookupKeys]);
      const keys = new Set(accept(lookupKeysInput, [...lookupKeys]));
      return prices.filter((price) => price.lookupKey !== null && keys.has(price.lookupKey));
    },
  };
}
