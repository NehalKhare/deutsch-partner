import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { PRICING_FAQ } from "@/lib/billing/copy";
import { SIGNED_OUT, type PriceList, type PricingViewer } from "@/lib/billing/offers";

import { ALL_PRICES } from "../billing/fixtures";

/**
 * /pricing: public, indexed, and the page a price is checked against.
 *
 * Every figure on it comes from the Stripe mirror at request time; the page
 * is tested with the mirror full, empty, and unreadable, and in each state it
 * must render — and in the last two, name no figure at all.
 */

const stubs = vi.hoisted(() => ({
  prices: { status: "ready", prices: [] } as PriceList,
  viewer: null as PricingViewer | null,
}));

vi.mock("@/lib/billing/catalogue", () => ({ currentPrices: async () => stubs.prices }));
vi.mock("@/lib/billing/viewer", () => ({ pricingViewer: async () => stubs.viewer ?? SIGNED_OUT }));

const { default: PricingPage, metadata } = await import("@/app/pricing/page");

async function renderPage() {
  return render(await PricingPage());
}

beforeEach(() => {
  stubs.prices = { status: "ready", prices: ALL_PRICES };
  stubs.viewer = null;
});

describe("/pricing", () => {
  it("is a public page with its own title and canonical", () => {
    expect(metadata.title).toBe("Plans and prices");
    expect(metadata.alternates?.canonical).toBe("/pricing");
  });

  it("has one first-level heading", async () => {
    await renderPage();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("never skips a heading level on the way down to a plan's name", async () => {
    await renderPage();

    const levels = screen.getAllByRole("heading").map((heading) => Number(heading.tagName.slice(1)));
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]!, `heading ${index}`).toBeLessThanOrEqual(1);
    });
  });

  it("shows the three plans with prices that include VAT", async () => {
    await renderPage();

    const plans = screen.getByRole("list", { name: "Plans" });
    expect(within(plans).getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(within(plans).getAllByText(/incl\. VAT/).length).toBeGreaterThanOrEqual(2);
  });

  it("offers the passes under their own anchor, for the landing page's link", async () => {
    const { container } = await renderPage();

    const passes = container.querySelector("#passes");
    expect(passes).not.toBeNull();
    expect(within(passes as HTMLElement).getByRole("heading", { name: /prefer no subscription/i })).toBeInTheDocument();
    expect(within(passes as HTMLElement).getByText("€44.99")).toBeInTheDocument();
  });

  it("compares every plan in a table", async () => {
    await renderPage();

    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("says what is always free", async () => {
    await renderPage();

    expect(screen.getByRole("list", { name: /always free on every plan/i })).toBeInTheDocument();
  });

  it("names the payment methods, where Stripe offers them", async () => {
    await renderPage();

    expect(screen.getAllByText(/Klarna/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/where available/i).length).toBeGreaterThanOrEqual(1);
  });

  it("answers the pricing questions in the open, as its structured data asks them", async () => {
    const { container } = await renderPage();

    const section = screen.getByRole("region", { name: /before you pay/i });
    for (const entry of PRICING_FAQ) {
      expect(within(section).getByRole("heading", { level: 3, name: entry.question })).toBeInTheDocument();
    }

    const script = container.querySelector('script[type="application/ld+json"]');
    const graph = JSON.parse(script!.textContent ?? "")["@graph"] as Array<Record<string, unknown>>;
    const faq = graph.find((node) => node["@type"] === "FAQPage")!;
    expect((faq.mainEntity as Array<{ name: string }>).map((entry) => entry.name)).toEqual(
      PRICING_FAQ.map((entry) => entry.question),
    );
  });

  it("carries Offer markup built from the mirror", async () => {
    const { container } = await renderPage();

    const script = container.querySelector('script[type="application/ld+json"]');
    const graph = JSON.parse(script!.textContent ?? "")["@graph"] as Array<Record<string, unknown>>;
    const app = graph.find((node) => node["@type"] === "WebApplication")!;
    const prices = (app.offers as Array<{ price: string }>).map((offer) => offer.price);
    expect(prices).toContain("9.99");
  });

  it("says prices are being set up, and names no figure, before the first sync", async () => {
    stubs.prices = { status: "ready", prices: [] };
    await renderPage();

    expect(screen.getAllByText(/prices are being set up/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("main").textContent).not.toMatch(/€/);
  });

  it("still renders, without a figure, when the mirror cannot be read", async () => {
    stubs.prices = { status: "unavailable" };
    await renderPage();

    expect(screen.getAllByText(/could not be loaded/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("main").textContent).not.toMatch(/€/);
  });

  it("sends a signed-in learner straight to the order page", async () => {
    stubs.viewer = { signedIn: true, plan: "free", subscribed: false, trialing: false, trialEligible: true };
    await renderPage();

    expect(screen.getByRole("link", { name: "Choose Plus" })).toHaveAttribute(
      "href",
      "/billing/checkout?offer=dp_plus_month",
    );
  });
});
