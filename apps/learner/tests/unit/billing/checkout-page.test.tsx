import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { SubscriptionGrant } from "@dp/domain/billing";

import type { PriceList } from "@/lib/billing/offers";
import type { BillingStanding } from "@/lib/billing/standing";

import { formatBillingDate } from "@/lib/billing/format";

import { ALL_PRICES } from "./fixtures";

/**
 * The order page (billing-and-plans-spec.md S6, S11).
 *
 * Directly above its button it must state the plan's main features, the
 * total price including VAT, the billing interval, that it renews until
 * cancelled, and how to cancel; carry one unticked early-start box; and say
 * "Order with obligation to pay" on the button. When any of that cannot be
 * stated truthfully — no price, payments off, a subscription already held —
 * there is no button at all.
 */

const stubs = vi.hoisted(() => ({
  prices: { status: "ready", prices: [] } as PriceList,
  standing: null as BillingStanding | null,
  payments: true,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireAuthenticatedUserId: async () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("@/lib/billing/catalogue", () => ({ currentPrices: async () => stubs.prices }));
vi.mock("@/lib/billing/entitlement", () => ({ currentBilling: async () => stubs.standing }));
vi.mock("@/lib/api/composition", () => ({ paymentsEnabled: () => stubs.payments }));
vi.mock("@/app/(app)/billing/actions", () => ({
  placeOrderAction: async () => ({ status: "idle", message: null }),
}));

const { default: CheckoutPage } = await import("@/app/(app)/billing/checkout/page");

const FREE: BillingStanding = {
  readable: true,
  entitlement: { plan: "free", source: "free", until: null },
  subscription: null,
  paidSubscription: null,
  trial: null,
  passes: [],
  hasCustomer: false,
  trialEligible: true,
  trialUsed: false,
};

async function renderOrder(offer: string | undefined) {
  return render(await CheckoutPage({ searchParams: Promise.resolve(offer === undefined ? {} : { offer }) }));
}

/** The form's block: everything the spec says must sit directly above the button. */
const orderBlock = () => screen.getByRole("button", { name: "Order with obligation to pay" }).closest("form")!;

beforeEach(() => {
  stubs.prices = { status: "ready", prices: ALL_PRICES };
  stubs.standing = FREE;
  stubs.payments = true;
});

describe("ordering a monthly plan", () => {
  it("says what is being ordered", async () => {
    await renderOrder("dp_plus_month");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Deutsch Partner Plus/);
  });

  it("states the features, the price with VAT, the interval, the renewal and how to cancel, above the button", async () => {
    await renderOrder("dp_plus_month");

    const block = within(orderBlock());
    expect(block.getByText("150 tutor turns a day")).toBeInTheDocument();
    expect(block.getByText(/€9\.99 per month, including VAT/)).toBeInTheDocument();
    expect(block.getByText(/renews every month until you cancel/i)).toBeInTheDocument();
    expect(block.getByText(/cancel any time on Plan & billing/i)).toBeInTheDocument();
  });

  it("asks for the early start with one unticked box", async () => {
    await renderOrder("dp_plus_month");

    const boxes = within(orderBlock()).getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[0]).toBeRequired();
    expect(boxes[0]).toHaveAccessibleName(/start immediately.*withdraw within 14 days/i);
  });

  it("has a button that says the order costs money, and nothing else", async () => {
    await renderOrder("dp_plus_month");

    expect(screen.getByRole("button", { name: "Order with obligation to pay" })).toHaveAttribute("type", "submit");
  });

  it("carries the offer and the amount shown, so a price that moved is refused", async () => {
    await renderOrder("dp_plus_month");

    const form = orderBlock();
    expect((form.querySelector('input[name="offer"]') as HTMLInputElement).value).toBe("dp_plus_month");
    expect((form.querySelector('input[name="shownAmountMinor"]') as HTMLInputElement).value).toBe("999");
  });

  it("links the terms the order is placed under", async () => {
    await renderOrder("dp_plus_month");

    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/legal/terms");
  });
});

describe("ordering other offers", () => {
  it("states a yearly price as its yearly total, with the month beside it", async () => {
    await renderOrder("dp_premium_year");

    const block = within(orderBlock());
    expect(block.getByText(/€139\.99 per year, including VAT/)).toBeInTheDocument();
    expect(block.getByText(/€11\.67 a month/)).toBeInTheDocument();
    expect(block.getByText(/renews every year until you cancel/i)).toBeInTheDocument();
  });

  it("states that a pass is paid once and does not renew", async () => {
    await renderOrder("dp_pass_plus");

    const block = within(orderBlock());
    expect(block.getByText(/€44\.99 once, including VAT, for 180 days of Plus/)).toBeInTheDocument();
    expect(block.getByText(/does not renew/i)).toBeInTheDocument();
  });
});

describe("ordering during the trial", () => {
  const TRIAL_END = new Date(Date.now() + 5 * 86_400_000);
  const trial: SubscriptionGrant = {
    planCode: "premium",
    status: "trialing",
    currentPeriodEnd: TRIAL_END,
    cancelAtPeriodEnd: true,
    trialEnd: TRIAL_END,
  };

  beforeEach(() => {
    stubs.standing = {
      ...FREE,
      entitlement: { plan: "premium", source: "subscription", until: TRIAL_END },
      subscription: trial,
      trial,
      hasCustomer: true,
      trialEligible: false,
      trialUsed: true,
    };
  });

  it("takes the order here, with its button — the trial is no subscription to change", async () => {
    await renderOrder("dp_premium_month");

    expect(screen.getByRole("button", { name: "Order with obligation to pay" })).toBeInTheDocument();
  });

  it("says, above the button, that the trial still ends and this is charged from now", async () => {
    await renderOrder("dp_premium_month");

    const block = within(orderBlock());
    expect(
      block.getByText(new RegExp(`trial still ends on ${formatBillingDate(TRIAL_END)}`)),
    ).toBeInTheDocument();
    expect(block.getByText(/first payment is taken when you complete the order/i)).toBeInTheDocument();
  });
});

describe("ordering a pass that stacks behind a running one", () => {
  const RUNNING_END = new Date(Date.now() + 170 * 86_400_000);

  beforeEach(() => {
    stubs.standing = {
      ...FREE,
      entitlement: { plan: "plus", source: "pass", until: RUNNING_END },
      passes: [{ planCode: "plus", startsAt: new Date(Date.now() - 10 * 86_400_000), endsAt: RUNNING_END, revokedAt: null }],
    };
  });

  it("says when it starts, because it does not start now", async () => {
    await renderOrder("dp_pass_plus");

    expect(
      within(orderBlock()).getByText(`Starts on ${formatBillingDate(RUNNING_END)}, when your current Plus pass ends.`),
    ).toBeInTheDocument();
  });

  it("asks for the start it will get, not an immediate one", async () => {
    await renderOrder("dp_pass_plus");

    const box = within(orderBlock()).getByRole("checkbox");
    expect(box).toHaveAccessibleName(new RegExp(`start on ${formatBillingDate(RUNNING_END)}, when my current pass ends`));
    expect(box).not.toHaveAccessibleName(/start immediately/);
  });

  it("starts a pass of the other plan now, beside the running one", async () => {
    await renderOrder("dp_pass_premium");

    expect(within(orderBlock()).queryByText(/^Starts on/)).not.toBeInTheDocument();
    expect(within(orderBlock()).getByRole("checkbox")).toHaveAccessibleName(/start immediately/);
  });
});

describe("no button when the order cannot be stated", () => {
  const noButton = () =>
    expect(screen.queryByRole("button", { name: "Order with obligation to pay" })).not.toBeInTheDocument();

  it("for an offer that is not one of ours", async () => {
    await renderOrder("dp_gold_forever");

    noButton();
    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/pricing");
  });

  it("for no offer at all", async () => {
    await renderOrder(undefined);

    noButton();
  });

  it("when payments are not switched on", async () => {
    stubs.payments = false;
    await renderOrder("dp_plus_month");

    noButton();
    expect(screen.getByText(/payments are not switched on yet/i)).toBeInTheDocument();
  });

  it("when the price is not in the mirror", async () => {
    stubs.prices = { status: "ready", prices: [] };
    await renderOrder("dp_plus_month");

    noButton();
    expect(screen.getByText(/not available just now/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/€/);
  });

  it("for a second subscription, sending the learner to change plan instead", async () => {
    const plus: SubscriptionGrant = {
      planCode: "plus",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
    };
    stubs.standing = {
      ...FREE,
      entitlement: { plan: "plus", source: "subscription", until: null },
      subscription: plus,
      paidSubscription: plus,
    };
    await renderOrder("dp_premium_month");

    noButton();
    expect(screen.getByRole("link", { name: /plan & billing/i })).toHaveAttribute("href", "/billing");
  });

  it("when the learner's plan could not be read", async () => {
    stubs.standing = { ...FREE, readable: false, trialEligible: false };
    await renderOrder("dp_plus_month");

    noButton();
  });
});
