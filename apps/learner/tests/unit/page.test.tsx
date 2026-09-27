import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as renderTree, screen, within } from "@testing-library/react";

import { MAX_GROWTH_STAGE } from "@dp/domain/companion";
import { SIGNED_OUT, type PriceList, type PricingViewer } from "@/lib/billing/offers";
import { FAQ } from "@/lib/landing/faq";

import { ALL_PRICES } from "./billing/fixtures";

/**
 * The landing page reads two things per request now — the price mirror and
 * who is looking — and both are stubbed here: what is under test is what
 * the page does with them, including when the mirror cannot be read at all.
 */
const stubs = vi.hoisted(() => ({
  prices: { status: "ready", prices: [] } as PriceList,
  viewer: null as PricingViewer | null,
}));

vi.mock("@/lib/billing/catalogue", () => ({ currentPrices: async () => stubs.prices }));
vi.mock("@/lib/billing/viewer", () => ({ pricingViewer: async () => stubs.viewer ?? SIGNED_OUT }));

const { default: Home } = await import("@/app/page");

/** The page is a server component that awaits its data; render what it resolves to. */
async function render() {
  return renderTree(await Home());
}

beforeEach(() => {
  stubs.prices = { status: "ready", prices: ALL_PRICES };
  stubs.viewer = null;
});

describe("landing page", () => {
  it("leads with the invitation, in German", async () => {
    await render();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Sprich einfach los.");
    expect(heading).toHaveAttribute("lang", "de");
  });

  it("puts the English right underneath, never behind an interaction", async () => {
    await render();

    expect(screen.getByText("Just start talking.")).toBeInTheDocument();
  });

  it("marks every German passage so a screen reader switches voice", async () => {
    const { container } = await render();

    const german = container.querySelectorAll('[lang="de"]');
    expect(german.length).toBeGreaterThanOrEqual(3);
  });

  it("sends both calls to action to sign-up", async () => {
    await render();

    const starts = screen.getAllByRole("link", { name: /start free/i });
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (const link of starts) {
      expect(link).toHaveAttribute("href", "/auth/sign-up");
    }
  });

  it("offers a way back for someone who already has an account", async () => {
    await render();

    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/auth/login",
    );
  });

  it("shows a real correction rather than a claim about corrections", async () => {
    await render();

    expect(screen.getByText(/gestern nach Berlin gefahren/)).toBeInTheDocument();
    expect(screen.getByText(/third time this month/i)).toBeInTheDocument();
  });

  it("shows every growth stage in the progress strip", async () => {
    await render();

    const strip = screen.getByRole("list", { name: /growth stages/i });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(
      MAX_GROWTH_STAGE,
    );
  });

  it("keeps the decorative companions out of the accessibility tree", async () => {
    // Five identical blobs announced one after another is noise, and the
    // level range beside each one already carries the meaning.
    await render();

    const strip = screen.getByRole("list", { name: /growth stages/i });
    expect(within(strip).queryAllByRole("img")).toHaveLength(0);
  });

  it("states the certification limit rather than burying it", async () => {
    await render();

    expect(screen.getByText(/do not issue certificates/i)).toBeInTheDocument();
  });

  it("names what you can do, feature by feature, without a superlative", async () => {
    await render();

    const grid = screen.getByRole("list", { name: /what you can do/i });
    for (const room of ["Talk", "Train", "Play a scene", "Speak and listen"]) {
      expect(within(grid).getByRole("heading", { name: room })).toBeInTheDocument();
    }
    // The register check: this page describes, it does not shout.
    expect(grid.textContent).not.toMatch(/best|revolutionary|amazing|effortless/i);
  });

  it("gives the timeline at both paces, computed from the same hours", async () => {
    await render();

    // The A1 row: about 6 months at half an hour, about 3 at a full one.
    const row = screen.getByRole("row", { name: /A1/ });
    expect(within(row).getByText("about 6 months")).toBeInTheDocument();
    expect(within(row).getByText("about 3 months")).toBeInTheDocument();
  });

  it("says what the timeline is based on, and that pace differs", async () => {
    await render();

    expect(screen.getByText(/guided hours language schools plan/i)).toBeInTheDocument();
    expect(screen.getByText(/your pace will differ/i)).toBeInTheDocument();
  });

  it("explains why it is not tiring as a mechanism, not a mood", async () => {
    await render();

    expect(screen.getByText(/mostly language you\s+already handle/i)).toBeInTheDocument();
    expect(screen.getByText(/the next mini-level\s+comes to you/i)).toBeInTheDocument();
  });

  it("answers the questions a visitor asks, in the open and not behind a click", async () => {
    await render();

    const section = screen.getByRole("region", { name: /questions, answered plainly/i });
    for (const entry of FAQ) {
      expect(within(section).getByRole("heading", { level: 3, name: entry.question })).toBeInTheDocument();
      expect(within(section).getByText(entry.answer)).toBeInTheDocument();
    }
  });

  it("carries structured data that says what the page says", async () => {
    // What a search engine shows and what an answer engine quotes. The FAQ
    // in it must be the FAQ on the page: markup that claims more than the
    // page shows is markup that gets a site penalised.
    const { container } = await render();

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const graph = JSON.parse(script!.textContent ?? "")["@graph"] as Array<Record<string, unknown>>;
    const faq = graph.find((node) => node["@type"] === "FAQPage")!;
    const questions = (faq.mainEntity as Array<{ name: string }>).map((entry) => entry.name);
    expect(questions).toEqual(FAQ.map((entry) => entry.question));
    for (const question of questions) {
      expect(screen.getByRole("heading", { level: 3, name: question })).toBeInTheDocument();
    }
  });

  it("has one first-level heading and a section heading for each claim", async () => {
    await render();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the plans on the landing page", () => {
  const plans = () => screen.getByRole("region", { name: /start free\. pay when it earns it\./i });

  it("are a section of their own, after the timeline and before the questions", async () => {
    await render();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    const at = (text: RegExp) => headings.findIndex((heading) => text.test(heading ?? ""));
    expect(at(/how long it takes/i)).toBeLessThan(at(/pay when it earns it/i));
    expect(at(/pay when it earns it/i)).toBeLessThan(at(/questions, answered plainly/i));
  });

  it("show Free, Plus and Premium with prices from the mirror, VAT included", async () => {
    await render();

    const cards = within(plans()).getByRole("list", { name: "Plans" });
    expect(within(cards).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Free",
      "Plus",
      "Premium",
    ]);
    const plus = within(plans()).getByRole("listitem", { name: "Plus" });
    expect(within(plus).getByText("€9.99")).toBeInTheDocument();
    expect(within(plus).getByText(/incl\. VAT/)).toBeInTheDocument();
  });

  it("send a visitor to sign up with the order they chose, and Premium's trial along the same road", async () => {
    await render();

    const plus = within(plans()).getByRole("listitem", { name: "Plus" });
    expect(within(plus).getByRole("link", { name: "Choose Plus" })).toHaveAttribute(
      "href",
      `/auth/sign-up?next=${encodeURIComponent("/billing/checkout?offer=dp_plus_month")}`,
    );
    const premium = within(plans()).getByRole("listitem", { name: "Premium" });
    expect(within(premium).getByRole("link", { name: /try premium free/i })).toHaveAttribute(
      "href",
      `/auth/sign-up?next=${encodeURIComponent("/billing/trial")}`,
    );
  });

  it("send a signed-in learner straight to the order page", async () => {
    stubs.viewer = { signedIn: true, plan: "free", subscribed: false, trialing: false, trialEligible: true };
    await render();

    const plus = within(plans()).getByRole("listitem", { name: "Plus" });
    expect(within(plus).getByRole("link", { name: "Choose Plus" })).toHaveAttribute(
      "href",
      "/billing/checkout?offer=dp_plus_month",
    );
  });

  it("say where the passes and the full comparison are", async () => {
    await render();

    expect(within(plans()).getByRole("link", { name: /passes from €44\.99/i })).toHaveAttribute(
      "href",
      "/pricing#passes",
    );
    // A price shown is a price with VAT said beside it (spec S11, PAngV).
    expect(within(plans()).getByRole("link", { name: /passes from €44\.99/i })).toHaveTextContent(/incl\. VAT/);
    expect(within(plans()).getByRole("link", { name: /compare every feature/i })).toHaveAttribute("href", "/pricing");
  });

  it("say what stays free on every plan", async () => {
    await render();

    expect(within(plans()).getByText(/always free on every plan/i)).toBeInTheDocument();
    expect(within(plans()).getByText(/no locked chapters/i)).toBeInTheDocument();
  });

  it("never invent a price when the mirror cannot be read, and still render", async () => {
    stubs.prices = { status: "unavailable" };
    await render();

    expect(plans().textContent).not.toMatch(/€/);
    expect(within(plans()).getAllByRole("link", { name: "See pricing" }).length).toBeGreaterThanOrEqual(2);
    expect(within(plans()).getAllByRole("listitem", { name: /Free|Plus|Premium/ })).toHaveLength(3);
  });

  it("say nothing about passes they cannot price", async () => {
    stubs.prices = { status: "ready", prices: [] };
    await render();

    expect(plans().textContent).not.toMatch(/€/);
    expect(within(plans()).getByRole("link", { name: /passes/i })).toHaveAttribute("href", "/pricing#passes");
  });

  it("are one click from the header, and the footer links the full price list", async () => {
    await render();

    expect(screen.getByRole("link", { name: "Plans" })).toHaveAttribute("href", "#plans");
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
  });

  it("leave the landing page's structured data free to start and without offers", async () => {
    const { container } = await render();

    const script = container.querySelector('script[type="application/ld+json"]');
    const graph = JSON.parse(script!.textContent ?? "")["@graph"] as Array<Record<string, unknown>>;
    const app = graph.find((node) => node["@type"] === "WebApplication")!;
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers).toBeUndefined();
  });
});
