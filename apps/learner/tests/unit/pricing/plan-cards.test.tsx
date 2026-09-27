import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlanCards } from "@/components/pricing/plan-cards";
import { PassCards } from "@/components/pricing/pass-cards";
import { ComparisonTable } from "@/components/pricing/comparison-table";
import { AlwaysFree } from "@/components/pricing/always-free";
import { ALWAYS_FREE, COMPARISON_ROWS } from "@/lib/billing/copy";
import {
  SIGNED_OUT,
  offerCatalogue,
  passCards,
  planCards,
  type OfferCatalogue,
  type PricingViewer,
} from "@/lib/billing/offers";

import { ALL_PRICES } from "../billing/fixtures";

/**
 * The plan cards, drawn once and used on the landing page and on /pricing.
 *
 * What a visitor must be able to rely on: every price says VAT is in it, a
 * yearly price shows its yearly total and not only a flattering month, the
 * recommendation is said in words and not only in colour, and a missing
 * price is a missing price — never a number somebody made up.
 */

const ready = offerCatalogue({ status: "ready", prices: ALL_PRICES });
const empty = offerCatalogue({ status: "ready", prices: [] });
const unreadable = offerCatalogue({ status: "unavailable" });

function renderCards(
  catalogue: OfferCatalogue = ready,
  viewer: PricingViewer = SIGNED_OUT,
  surface: "landing" | "pricing" = "pricing",
) {
  return render(<PlanCards cards={planCards(catalogue, viewer)} surface={surface} catalogueReadable={catalogue.readable} />);
}

const cardFor = (name: string) => screen.getByRole("listitem", { name });

describe("the cards", () => {
  it("are Free, Plus and Premium", () => {
    renderCards();

    const list = screen.getByRole("list", { name: /plans/i });
    expect(within(list).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Free",
      "Plus",
      "Premium",
    ]);
  });

  it("say which one is recommended in words, not only in colour", () => {
    renderCards();

    expect(within(cardFor("Plus")).getByText("Recommended")).toBeInTheDocument();
    expect(within(cardFor("Premium")).queryByText("Recommended")).not.toBeInTheDocument();
  });

  it("show a monthly price with VAT included", () => {
    renderCards();

    const plus = cardFor("Plus");
    expect(within(plus).getByText("€9.99")).toBeInTheDocument();
    expect(within(plus).getByText(/per month/)).toBeInTheDocument();
    expect(within(plus).getByText(/incl\. VAT/)).toBeInTheDocument();
  });

  it("list what each plan includes, from the catalogue", () => {
    renderCards();

    expect(within(cardFor("Free")).getByText("20 tutor turns a day")).toBeInTheDocument();
    expect(within(cardFor("Premium")).getByText("300 tutor turns a day")).toBeInTheDocument();
  });

  it("call Free free, with no figure", () => {
    renderCards();

    const free = cardFor("Free");
    expect(within(free).getByText("No card needed")).toBeInTheDocument();
    expect(free.textContent).not.toMatch(/€/);
  });
});

describe("the interval", () => {
  it("is a labelled radio group, monthly first", () => {
    renderCards();

    const group = screen.getByRole("group", { name: /how often to pay/i });
    expect(within(group).getByRole("radio", { name: /monthly/i })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /yearly/i })).not.toBeChecked();
  });

  it("says how much paying yearly saves, rounded down", () => {
    renderCards();

    // Plus saves 41%, Premium 41%: the badge says the larger, no higher.
    expect(screen.getByRole("radio", { name: /yearly/i }).closest("label")).toHaveTextContent(/save up to 41%/i);
  });

  it("switches every card to yearly: the yearly total first, the month beside it", async () => {
    renderCards();

    await userEvent.click(screen.getByRole("radio", { name: /yearly/i }));

    const plus = cardFor("Plus");
    expect(within(plus).getByText("€69.99")).toBeInTheDocument();
    expect(within(plus).getByText(/per year/)).toBeInTheDocument();
    expect(within(plus).getByText(/€5\.84 a month/)).toBeInTheDocument();
    expect(within(plus).getByText(/incl\. VAT/)).toBeInTheDocument();
    expect(within(plus).getByRole("link", { name: "Choose Plus" }).getAttribute("href")).toContain(
      encodeURIComponent("offer=dp_plus_year"),
    );
  });
});

describe("the buttons", () => {
  it("send a visitor through sign-up, carrying the order", () => {
    renderCards();

    expect(within(cardFor("Free")).getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/auth/sign-up");
    expect(within(cardFor("Plus")).getByRole("link", { name: "Choose Plus" })).toHaveAttribute(
      "href",
      `/auth/sign-up?next=${encodeURIComponent("/billing/checkout?offer=dp_plus_month")}`,
    );
  });

  it("offer the trial on Premium, and say it needs no card", () => {
    renderCards();

    const trial = within(cardFor("Premium")).getByRole("link", { name: /try premium free for 7 days/i });
    expect(trial).toHaveAttribute("href", `/auth/sign-up?next=${encodeURIComponent("/billing/trial")}`);
    expect(within(cardFor("Premium")).getByText(/no card/i)).toBeInTheDocument();
  });

  it("mark the learner's own plan and offer nothing to press on it", () => {
    renderCards(ready, { signedIn: true, plan: "plus", subscribed: true, trialing: false, trialEligible: false });

    const plus = cardFor("Plus");
    expect(within(plus).getByText("Your plan")).toBeInTheDocument();
    expect(within(plus).queryByRole("link", { name: /choose/i })).not.toBeInTheDocument();
  });
});

describe("a missing price", () => {
  it("is said to be being set up on /pricing, with no button and no figure", () => {
    renderCards(empty, SIGNED_OUT, "pricing");

    const plus = cardFor("Plus");
    expect(within(plus).getByText(/prices are being set up/i)).toBeInTheDocument();
    expect(within(plus).queryByRole("link", { name: /choose/i })).not.toBeInTheDocument();
    expect(plus.textContent).not.toMatch(/€/);
  });

  it("is a way to the pricing page on the landing page", () => {
    renderCards(unreadable, SIGNED_OUT, "landing");

    expect(within(cardFor("Plus")).getByRole("link", { name: "See pricing" })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
  });

  it("is said to be unreadable on /pricing when the read failed, not that prices do not exist", () => {
    renderCards(unreadable, SIGNED_OUT, "pricing");

    expect(within(cardFor("Plus")).getByText(/could not be loaded/i)).toBeInTheDocument();
  });
});

describe("the passes", () => {
  it("show the price once, VAT included, the days, and that nothing renews", () => {
    render(<PassCards passes={passCards(ready, SIGNED_OUT)} surface="pricing" catalogueReadable />);

    const plus = screen.getByRole("listitem", { name: "Plus pass" });
    expect(within(plus).getByText("€44.99")).toBeInTheDocument();
    expect(within(plus).getByText(/incl\. VAT/)).toBeInTheDocument();
    expect(within(plus).getByText(/180 days of Plus/)).toBeInTheDocument();
    expect(within(plus).getByText(/no renewal/i)).toBeInTheDocument();
    expect(within(plus).getByRole("link", { name: "Buy the Plus pass" })).toHaveAttribute(
      "href",
      `/auth/sign-up?next=${encodeURIComponent("/billing/checkout?offer=dp_pass_plus")}`,
    );
  });

  it("have no button and no figure without a price", () => {
    render(<PassCards passes={passCards(empty, SIGNED_OUT)} surface="pricing" catalogueReadable />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/€/);
  });
});

describe("the comparison", () => {
  it("is a table with a column per plan and a row per dimension", () => {
    render(<ComparisonTable />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "What you get",
      "Free",
      "Plus",
      "Premium",
    ]);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(COMPARISON_ROWS.length);
  });

  it("says yes and no in words a screen reader reads", () => {
    render(<ComparisonTable />);

    const row = screen.getByRole("row", { name: /voice in the trainer/i });
    expect(within(row).getAllByText("Not included")).toHaveLength(2);
    expect(within(row).getByText("Included")).toBeInTheDocument();
  });

  it("marks what is not built yet", () => {
    render(<ComparisonTable />);

    expect(screen.getByRole("rowheader", { name: /hands-free conversation.*coming soon/i })).toBeInTheDocument();
  });
});

describe("what every plan keeps", () => {
  it("is listed in full", () => {
    render(<AlwaysFree />);

    const list = screen.getByRole("list", { name: /always free/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(ALWAYS_FREE.length);
  });
});
