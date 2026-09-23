import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpendChart, niceTicks } from "@/components/costs/spend-chart";
import { bucketSeries, dayKey, type DaySpend } from "@/lib/spend-series";

/**
 * The bar chart.
 *
 * One series and one axis, so most of what could go wrong here is arithmetic
 * that a reader would have to check by hand: an axis that does not round, a
 * bar whose label is somebody else's, a value that only a pointer can reach.
 */

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 8, 1);

const series: DaySpend[] = Array.from({ length: 10 }, (_, index) => ({
  day: dayKey(new Date(START + index * DAY_MS)),
  calls: 100 * (index + 1),
  costEur: index === 7 ? 64 : index + 1,
  inputTokens: 1000,
  outputTokens: 200,
  failures: 0,
  byTask: [],
  byModel: [],
}));

const weekly = bucketSeries(series, "weekly");

describe("niceTicks", () => {
  it("rounds an axis to numbers somebody can use as a ruler", () => {
    // 0 / 2.7183 / 5.4366 is an axis nobody can read a bar against.
    expect(niceTicks(64)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(9.4)).toEqual([0, 2.5, 5, 7.5, 10]);
    // Sub-cent axes round too: a task costing thousandths still gets a ruler.
    expect(niceTicks(0.0043)).toEqual([0, 0.002, 0.004, 0.006]);
  });

  it("always reaches past the tallest bar", () => {
    for (const max of [0.7, 3, 47, 64, 912, 5_400]) {
      const ticks = niceTicks(max);

      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
      expect(ticks[0]).toBe(0);
    }
  });

  it("collapses to a single tick when there is nothing to plot", () => {
    expect(niceTicks(0)).toEqual([0]);
  });
});

describe("SpendChart", () => {
  it("gives every bar a name carrying its figures", () => {
    render(<SpendChart buckets={weekly} caption="The last 7 days, one bar per day" />);

    // Reachable without a pointer, so the hover layer enhances rather than gates.
    expect(
      screen.getByRole("button", { name: "Fri 4 Sep: €4.00 over 400 calls" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tue 8 Sep: €64.00 over 800 calls" }),
    ).toBeInTheDocument();
  });

  it("labels only the peak bar", () => {
    render(<SpendChart buckets={weekly} caption="x" />);

    // A number on every bar is chaos and goes unread; the axis carries the rest.
    expect(screen.getAllByText("€64.00")).toHaveLength(1);
    expect(screen.queryByText("€4.00")).not.toBeInTheDocument();
  });

  it("reads a bar out on hover and on focus alike", async () => {
    const user = userEvent.setup();
    render(<SpendChart buckets={weekly} caption="x" />);

    // The first bar in the window, which ends on the newest day in the series.
    await user.tab();

    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent("400 calls");
    expect(readout).toHaveTextContent("Fri 4 Sep");
  });

  it("draws the daily ceiling when the bars are days", () => {
    render(<SpendChart buckets={weekly} caption="x" limitEur={50} />);

    expect(screen.getByText("daily limit")).toBeInTheDocument();
  });

  it("leaves the ceiling off when it sits above the whole axis", () => {
    // A rule drawn off the top of the plot is a rule that tells the reader
    // nothing and costs a gridline's worth of ink.
    const quiet = bucketSeries(
      series.map((day) => ({ ...day, costEur: 0.5 })),
      "weekly",
    );
    render(<SpendChart buckets={quiet} caption="x" limitEur={50} />);

    expect(screen.queryByText("daily limit")).not.toBeInTheDocument();
  });

  it("opens a day when its bar is a day", async () => {
    const user = userEvent.setup();
    const onSelectDay = vi.fn();
    render(<SpendChart buckets={weekly} caption="x" onSelectDay={onSelectDay} />);

    await user.click(screen.getByRole("button", { name: /Tue 8 Sep/ }));

    expect(onSelectDay).toHaveBeenCalledWith("2026-09-08");
  });

  it("does not offer to open a month, which is not a day", async () => {
    const user = userEvent.setup();
    const onSelectDay = vi.fn();
    const monthly = bucketSeries(series, "yearly");
    render(<SpendChart buckets={monthly} caption="x" onSelectDay={onSelectDay} />);

    await user.click(screen.getByRole("button", { name: /Sep 2026/ }));

    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it("says so rather than drawing an empty plot", () => {
    render(<SpendChart buckets={[]} caption="x" />);

    expect(screen.getByText("No days in this window.")).toBeInTheDocument();
  });
});
