import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpendExplorer } from "@/components/costs/spend-explorer";
import { dayKey, type DaySpend } from "@/lib/spend-series";

/**
 * The explorer.
 *
 * Three things are worth holding down here, and all three are ways the screen
 * could lie rather than ways it could look wrong.
 *
 * The tabs must rescope *everything* — a headline figure left over from the
 * previous tab is a number that reads as fact and is not one. An empty rollup
 * must read as an empty rollup rather than as a year in which nothing was
 * spent, because those two have the same picture and completely different
 * fixes. And clicking a day must open that day, not a day near it.
 */

const AS_OF = new Date("2026-09-23T09:00:00.000Z");
const DAY_MS = 86_400_000;

/** A year ending on `AS_OF`, at a euro a day, with one costly Tuesday. */
const SERIES: DaySpend[] = Array.from({ length: 300 }, (_, index) => {
  const date = dayKey(new Date(AS_OF.getTime() - (299 - index) * DAY_MS));
  const costEur = date === "2026-09-22" ? 64 : 1;

  return {
    day: date,
    calls: costEur === 64 ? 5000 : 100,
    costEur,
    inputTokens: 10_000,
    outputTokens: 2_000,
    failures: 0,
    byTask: [
      { task: "conversation.turn", tier: "strong", modelId: "vendor/strong-model", calls: 60, costEur: costEur * 0.8, inputTokens: 8000, outputTokens: 1800 },
      { task: "classification.intent", tier: "nano", modelId: "vendor/nano-model", calls: 40, costEur: costEur * 0.2, inputTokens: 2000, outputTokens: 200 },
    ],
    byModel: [{ modelId: "strong tier", calls: 100, costEur }],
  };
});

function setup(over: Partial<React.ComponentProps<typeof SpendExplorer>> = {}) {
  render(
    <SpendExplorer series={SERIES} dailyLimitEur={50} asOf={AS_OF} {...over} />,
  );

  return userEvent.setup();
}

const metric = (label: string) =>
  screen.getByText(label).parentElement?.textContent ?? "";

describe("SpendExplorer", () => {
  it("opens on the calendar", () => {
    setup();

    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("grid", { name: /Daily AI spend for 2026/ })).toBeInTheDocument();
  });

  it("rescopes every headline figure when the timeframe changes", async () => {
    const user = setup();

    // The calendar's window is the year on screen — 1 January to 31 December
    // 2026 — which holds 265 of the series' days at a euro plus the €64
    // Tuesday. The days before January belong to the previous year's calendar.
    expect(metric("Total spend")).toContain("€329.00");

    await user.click(screen.getByRole("tab", { name: "Weekly" }));

    // Seven days: six at a euro and the €64 day. Nothing is left over from
    // the year — a stale headline is a number that reads as fact and is not.
    expect(metric("Total spend")).toContain("€70.00");
    expect(metric("Average daily cost")).toContain("€10.00");
  });

  it("names the costliest day and flags it when it broke the ceiling", async () => {
    const user = setup();
    await user.click(screen.getByRole("tab", { name: "Weekly" }));

    expect(metric("Peak usage day")).toContain("€64.00");
    expect(metric("Peak usage day")).toContain("Tue 22 Sep");
  });

  it("averages over every day in the window, quiet ones included", () => {
    setup();

    // Said on the card, because somebody is going to multiply it by 365.
    expect(metric("Average daily cost")).toContain(
      "Across every day in the window, quiet ones included",
    );
  });

  it("swaps the calendar for a chart on the other three tabs", async () => {
    const user = setup();

    for (const [tab, caption] of [
      ["Weekly", "The last 7 days, one bar per day"],
      ["Monthly", "The last 30 days, one bar per day"],
      ["Yearly", "The last 12 months, one bar per month"],
    ] as const) {
      await user.click(screen.getByRole("tab", { name: tab }));

      expect(screen.getByText(caption)).toBeInTheDocument();
      expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    }
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = setup();

    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Weekly" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // And it wraps, so there is no dead end at either edge.
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Yearly" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens the newest day that has calls, not the last cell of the calendar", () => {
    setup();

    // The calendar's window runs to 31 December, which has not happened. A
    // panel opening there reports no calls and reads as a product nobody
    // used, rather than as a year that is not over.
    expect(
      screen.getByRole("heading", { name: "Wed 23 Sep" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No model was called on this day.")).not.toBeInTheDocument();
  });

  it("opens the day that was clicked, with its tokens and its models", async () => {
    const user = setup();

    await user.click(screen.getByRole("gridcell", { name: /Tue 22 Sep/ }));

    const detail = screen.getByRole("region", { name: "Tue 22 Sep" });
    // Twice over: once as the day's headline figure and once in the sentence
    // explaining what it breached.
    expect(within(detail).getAllByText("€64.00")).not.toHaveLength(0);
    expect(within(detail).getByText("5,000")).toBeInTheDocument();
    // The thing the calendar cell cannot say: what the money went on.
    expect(within(detail).getByText("Models routed to")).toBeInTheDocument();
    expect(within(detail).getByText("strong tier")).toBeInTheDocument();
    expect(within(detail).getByText("conversation.turn")).toBeInTheDocument();
  });

  it("names the model each task actually ran on", async () => {
    const user = setup();

    await user.click(screen.getByRole("gridcell", { name: /Tue 22 Sep/ }));

    const detail = screen.getByRole("region", { name: "Tue 22 Sep" });
    const tasks = within(detail)
      .getAllByRole("table")
      .find((table) => within(table).queryByRole("columnheader", { name: "Task" }));
    if (!tasks) throw new Error("no Tasks table");

    expect(within(tasks).getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    const turn = within(tasks).getByText("conversation.turn").closest("tr");
    expect(turn).toHaveTextContent("vendor/strong-model");
    const intent = within(tasks).getByText("classification.intent").closest("tr");
    expect(intent).toHaveTextContent("vendor/nano-model");
  });

  it("explains a day that broke the ceiling rather than only colouring it", async () => {
    const user = setup();

    await user.click(screen.getByRole("gridcell", { name: /Tue 22 Sep/ }));

    expect(
      screen.getByText(/Over the daily limit\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ceiling of €50\.00/),
    ).toBeInTheDocument();
  });

  it("never stands anything in for figures it does not have", () => {
    setup({ series: [] });

    // No tabs, no cards, no calendar: an empty rollup has nothing to explore,
    // and a grid of 365 blank cells would claim the product went unused.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.queryByText("Total spend")).not.toBeInTheDocument();
  });

  it("says why the year is empty, and what fills it", () => {
    setup({ series: [] });

    expect(
      screen.getByRole("heading", { name: "No daily history yet" }),
    ).toBeInTheDocument();
    // Named, because "no data" sends somebody looking at the ledger, and the
    // ledger is not the thing that is empty.
    expect(screen.getByText("cost.rollup")).toBeInTheDocument();
    // And the figures that do not depend on it are pointed at.
    expect(screen.getByText(/Last 24 hours/)).toBeInTheDocument();
  });
});

describe("the calendar's window", () => {
  it("stops at today rather than averaging over a year that is not over", () => {
    setup();

    // The grid draws twelve months because that is what a calendar is. The
    // arithmetic must not: 2026 has 365 days and 266 of them have happened,
    // and dividing by the larger number puts the headline a third too low.
    expect(metric("Total spend")).toContain("over 266 days");
    expect(metric("Average daily cost")).toContain("€1.24");
  });
});
