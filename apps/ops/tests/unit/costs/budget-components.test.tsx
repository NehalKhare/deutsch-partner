import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BudgetLimitForm } from "@/components/costs/budget-limit-form";
import { BudgetMeter } from "@/components/costs/budget-meter";
import { CostsTabs, activeCostTab } from "@/components/costs/costs-tabs";
import type { BudgetFormState } from "@/lib/budgets";

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/costs" } }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("the spend room's tabs", () => {
  it("lights the spend page only on the spend page itself", () => {
    expect(activeCostTab("/costs")).toBe("/costs");
    expect(activeCostTab("/costs/budgets")).toBe("/costs/budgets");
  });

  it("lights the ledger on a single call's page", () => {
    expect(activeCostTab("/costs/invocations/912")).toBe("/costs/invocations");
  });

  it("marks the current page for assistive technology", () => {
    pathname.current = "/costs/pricing";
    render(<CostsTabs />);

    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Spend" })).not.toHaveAttribute("aria-current");
  });
});

describe("a budget meter", () => {
  it("says what the gateway is doing, not only how full the bar is", () => {
    render(
      <BudgetMeter
        label="Whole product, per day"
        meter={{ limitEur: 50, spentEur: 46, ratio: 0.92, state: "degrade" }}
        warnPct={0.7}
        degradePct={0.9}
      />,
    );

    const bar = screen.getByRole("meter", { name: "Whole product, per day" });
    expect(bar).toHaveAttribute("aria-valuenow", "92");
    expect(bar).toHaveAttribute("aria-valuetext", expect.stringContaining("cheaper tier"));
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });

  it("renders no spend without dividing by zero", () => {
    render(
      <BudgetMeter label="Whole product, per day" meter={{ limitEur: 50, spentEur: 0, ratio: 0, state: "allow" }} />,
    );

    expect(screen.getByText("€0")).toBeInTheDocument();
    expect(screen.getByText("Within budget")).toBeInTheDocument();
  });

  it("calls a missing limit what it is", () => {
    render(
      <BudgetMeter
        label="Each learner, per day"
        meter={{ limitEur: null, spentEur: 3, ratio: null, state: "unlimited" }}
      />,
    );

    expect(screen.getByText("No limit")).toBeInTheDocument();
    expect(screen.getByText(/allows unlimited spend/)).toBeInTheDocument();
    expect(screen.getByRole("meter")).not.toHaveAttribute("aria-valuenow");
  });
});

describe("the limit form", () => {
  const saved: BudgetFormState = { status: "saved", message: "Saved." };

  it("offers no way to switch a scope's default off", () => {
    render(
      <BudgetLimitForm action={vi.fn(async () => saved)} mode="default" scope="global_daily" limitEur="50" />,
    );

    expect(screen.queryByRole("checkbox", { name: "Active" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Limit (EUR)")).toHaveValue("50");
  });

  it("posts what the operator typed and shows what the action said", async () => {
    const action = vi.fn(async (_state: BudgetFormState, _data: FormData) => saved);
    render(<BudgetLimitForm action={action} mode="override" scope="per_user_daily" scopeKey={"a".repeat(32)} limitEur="2" />);

    const limitField = screen.getByLabelText("Limit (EUR)");
    await userEvent.clear(limitField);
    await userEvent.type(limitField, "3,5");
    await userEvent.click(screen.getByRole("checkbox", { name: "Active" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    const posted = action.mock.calls[0]?.[1];
    expect(posted?.get("limitEur")).toBe("3,5");
    expect(posted?.get("scopeKey")).toBe("a".repeat(32));
    // Unticked: posted as absent, which the action reads as paused.
    expect(posted?.get("active")).toBeNull();
  });

  it("asks for a scope and a pseudonym when adding an override", () => {
    render(<BudgetLimitForm action={vi.fn(async () => saved)} mode="new-override" />);

    expect(screen.getByLabelText("Scope")).toHaveValue("per_user_daily");
    expect(screen.getByLabelText("Learner pseudonym")).toBeRequired();
    expect(screen.getByRole("button", { name: "Add override" })).toBeInTheDocument();
  });
});
