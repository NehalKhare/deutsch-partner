import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { SubscriptionGrant } from "@dp/domain/billing";

import type { PriceList } from "@/lib/billing/offers";
import type { BillingStanding } from "@/lib/billing/standing";

import { ALL_PRICES } from "./fixtures";

/**
 * Plan & billing, the trial page, and the page Stripe returns to.
 *
 * Each is rendered from the learner's own standing, stubbed here. The rule
 * that matters most is on the return page: it shows a plan once the webhook
 * has written one, and waits honestly until then — it never grants anything.
 */

const stubs = vi.hoisted(() => ({
  prices: { status: "ready", prices: [] } as PriceList,
  standing: null as BillingStanding | null,
  payments: true,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/current-user", () => ({
  requireAuthenticatedUserId: async () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("@/lib/billing/catalogue", () => ({ currentPrices: async () => stubs.prices }));
vi.mock("@/lib/billing/entitlement", () => ({ currentBilling: async () => stubs.standing }));
vi.mock("@/lib/api/composition", () => ({ paymentsEnabled: () => stubs.payments }));
vi.mock("@/app/(app)/billing/actions", () => ({
  openPortalAction: async () => ({ status: "idle", message: null }),
  startTrialAction: async () => ({ status: "idle", message: null }),
}));

const { default: BillingPage } = await import("@/app/(app)/billing/page");
const { default: TrialPage } = await import("@/app/(app)/billing/trial/page");
const { default: SuccessPage } = await import("@/app/(app)/billing/success/page");

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

const PERIOD_END = new Date("2026-10-12T09:30:00Z");

function subscribed(over: Partial<SubscriptionGrant> = {}): BillingStanding {
  const subscription: SubscriptionGrant = {
    planCode: "plus",
    status: "active",
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    ...over,
  };
  const trialing = subscription.status === "trialing";
  return {
    readable: true,
    entitlement: { plan: subscription.planCode, source: "subscription", until: PERIOD_END },
    subscription,
    paidSubscription: trialing ? null : subscription,
    trial: trialing ? subscription : null,
    passes: [],
    hasCustomer: true,
    trialEligible: false,
    trialUsed: subscription.trialEnd !== null,
  };
}

beforeEach(() => {
  stubs.prices = { status: "ready", prices: ALL_PRICES };
  stubs.standing = FREE;
  stubs.payments = true;
});

describe("Plan & billing", () => {
  const renderPage = async (checkout?: string) =>
    render(await BillingPage({ searchParams: Promise.resolve(checkout ? { checkout } : {}) }));

  it("says what a Free learner has, and where the plans are", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Plan & billing");
    expect(screen.getByText("Free, with daily limits and no card.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see plans and prices/i })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();
  });

  it("says when a subscription renews, and opens the Customer Portal to manage it", async () => {
    stubs.standing = subscribed();
    await renderPage();

    expect(screen.getByText("Plus · renews on 12 October 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
  });

  it("says Klarna and iDEAL payers change method by re-subscribing", async () => {
    stubs.standing = subscribed();
    await renderPage();

    expect(screen.getByText(/Klarna or iDEAL/)).toBeInTheDocument();
  });

  it("warns when a payment failed, while access carries on", async () => {
    stubs.standing = subscribed({ status: "past_due" });
    await renderPage();

    expect(screen.getByText(/last payment did not go through/i)).toBeInTheDocument();
  });

  it("says a cancelled subscription ends and will not renew", async () => {
    stubs.standing = subscribed({ cancelAtPeriodEnd: true });
    await renderPage();

    expect(screen.getByText(/ends on 12 October 2026 and will not renew/)).toBeInTheDocument();
  });

  it("says a checkout that was left charged nothing", async () => {
    await renderPage("cancelled");

    expect(screen.getByText(/checkout was cancelled\. nothing was charged/i)).toBeInTheDocument();
  });

  it("offers the trial to a learner who has not had it", async () => {
    await renderPage();

    expect(screen.getByRole("link", { name: /try premium free/i })).toHaveAttribute("href", "/billing/trial");
  });

  it("lists what stays free", async () => {
    await renderPage();

    expect(screen.getByRole("list", { name: /always free on every plan/i })).toBeInTheDocument();
  });

  it("says the plan could not be read rather than calling a subscriber Free", async () => {
    stubs.standing = { ...FREE, readable: false, trialEligible: false };
    await renderPage();

    expect(screen.getByText(/could not be read just now/i)).toBeInTheDocument();
    expect(screen.queryByText("Free, with daily limits and no card.")).not.toBeInTheDocument();
  });

  describe("during the trial", () => {
    const onTrial = () =>
      subscribed({ planCode: "premium", status: "trialing", cancelAtPeriodEnd: true, trialEnd: PERIOD_END });

    it("offers no Customer Portal, where a card added would turn the trial into a charge", async () => {
      stubs.standing = onTrial();
      await renderPage();

      expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();
      expect(screen.queryByText(/replace your card/i)).not.toBeInTheDocument();
    });

    it("sends the learner to order what comes after it, on the pricing page", async () => {
      stubs.standing = onTrial();
      await renderPage();

      expect(screen.getByText(/to keep premium after the trial, or to choose plus/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /see plans and prices/i })).toHaveAttribute("href", "/pricing");
    });
  });

  it("does not offer the portal when payments are off", async () => {
    stubs.standing = subscribed();
    stubs.payments = false;
    await renderPage();

    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();
  });
});

describe("the trial page", () => {
  const renderPage = async () => render(await TrialPage());

  it("says what the trial is and that it costs nothing, with no order button", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Try Premium free for 7 days");
    expect(screen.getByText(/no card is asked for/i)).toBeInTheDocument();
    expect(screen.getByText(/ends by itself/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start my free trial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /obligation to pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says the trial has been used, with no button", async () => {
    stubs.standing = { ...FREE, trialEligible: false, trialUsed: true };
    await renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/trial has been used/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells a learner who subscribed without a trial what is true: it is for new accounts", async () => {
    stubs.standing = { ...FREE, trialEligible: false, trialUsed: false };
    await renderPage();

    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent(/has been used/i);
    expect(screen.getByText(/for accounts that have not subscribed before/i)).toBeInTheDocument();
    expect(screen.queryByText(/this account has had it/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("waits for payments to be switched on", async () => {
    stubs.payments = false;
    await renderPage();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has no button when Premium's price is not in the mirror", async () => {
    stubs.prices = { status: "ready", prices: [] };
    await renderPage();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the return from Stripe", () => {
  const renderPage = async (offer?: string) =>
    render(await SuccessPage({ searchParams: Promise.resolve(offer ? { offer } : {}) }));

  it("waits, and says it is waiting, until the webhook has written the plan", async () => {
    await renderPage("dp_plus_month");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/confirming/i);
    expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
  });

  it("welcomes the learner once the plan is theirs", async () => {
    stubs.standing = subscribed();
    await renderPage("dp_plus_month");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome to Plus");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start a conversation/i })).toHaveAttribute("href", "/chat");
  });

  it("keeps waiting while the plan held is below the one ordered", async () => {
    stubs.standing = subscribed();
    await renderPage("dp_pass_premium");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/confirming/i);
  });
});
