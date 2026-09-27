/**
 * Stripe objects as the API returns them in 2026-08-26.dahlia, cut down to
 * the fields the provider reads plus a few it must ignore. Each builder
 * starts from a valid object so a test states only what it changes.
 *
 * Amounts are integer minor units, as Stripe sends them.
 */

type Overrides<T> = { [K in keyof T]?: T[K] };

export const T0 = 1_790_000_000; // 2026-09-21T14:13:20Z, in Stripe's seconds

export function stripePrice(over: Record<string, unknown> = {}) {
  return {
    id: "price_PlusMonth",
    object: "price",
    active: true,
    currency: "eur",
    lookup_key: "dp_plus_month",
    metadata: { plan_code: "plus" },
    nickname: null,
    product: "prod_Plus",
    recurring: { interval: "month", interval_count: 1, meter: null, usage_type: "licensed" },
    tax_behavior: "inclusive",
    type: "recurring",
    unit_amount: 999,
    unit_amount_decimal: "999",
    ...over,
  };
}

export function stripeSubscription(over: Record<string, unknown> = {}) {
  return {
    id: "sub_Alice1",
    object: "subscription",
    customer: "cus_Alice",
    status: "active",
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    // In this API version the period is the item's. A subscription-level
    // field would be ignored if it were here, which is the point of it.
    items: {
      object: "list",
      data: [
        {
          id: "si_Alice1",
          object: "subscription_item",
          current_period_start: T0,
          current_period_end: T0 + 30 * 86_400,
          price: stripePrice(),
          quantity: 1,
        },
      ],
      has_more: false,
    },
    metadata: {},
    ...over,
  };
}

export function stripeCheckoutSession(over: Record<string, unknown> = {}) {
  return {
    id: "cs_test_Order1",
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    customer: "cus_Alice",
    subscription: "sub_Alice1",
    payment_intent: null,
    client_reference_id: "33333333-3333-4333-8333-333333333333",
    amount_total: 999,
    currency: "eur",
    url: null,
    customer_details: { email: "alice@example.com", name: "Alice Example" },
    line_items: {
      object: "list",
      data: [{ id: "li_1", object: "item", price: stripePrice(), quantity: 1 }],
      has_more: false,
    },
    ...over,
  };
}

export function stripePassSession(over: Record<string, unknown> = {}) {
  return stripeCheckoutSession({
    id: "cs_test_Pass1",
    mode: "payment",
    subscription: null,
    payment_intent: "pi_Pass1",
    amount_total: 4499,
    line_items: {
      object: "list",
      data: [
        {
          id: "li_2",
          object: "item",
          price: stripePrice({
            id: "price_PassPlus",
            lookup_key: "dp_pass_plus",
            metadata: { plan_code: "plus", pass_days: "180" },
            recurring: null,
            type: "one_time",
            unit_amount: 4499,
          }),
          quantity: 1,
        },
      ],
      has_more: false,
    },
    ...over,
  });
}

export function stripeCharge(over: Record<string, unknown> = {}) {
  return {
    id: "ch_Pass1",
    object: "charge",
    amount: 4499,
    amount_refunded: 4499,
    payment_intent: "pi_Pass1",
    refunded: true,
    billing_details: { email: "alice@example.com", name: "Alice Example" },
    payment_method_details: { card: { brand: "visa", last4: "4242" } },
    ...over,
  };
}

export function stripeInvoice(over: Record<string, unknown> = {}) {
  return {
    id: "in_Alice1",
    object: "invoice",
    customer: "cus_Alice",
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { metadata: {}, subscription: "sub_Alice1" },
    },
    ...over,
  };
}

export function stripeEvent(type: string, object: Record<string, unknown>, over: Overrides<{ id: string; created: number }> = {}) {
  return {
    id: over.id ?? "evt_1",
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: over.created ?? T0,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
}
