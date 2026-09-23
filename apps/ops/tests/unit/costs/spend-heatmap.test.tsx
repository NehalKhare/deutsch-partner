import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpendHeatmap } from "@/components/costs/spend-heatmap";
import { calendarGrid, type DaySpend } from "@/lib/spend-series";

/**
 * The calendar.
 *
 * What is worth asserting is not that 365 squares rendered. It is that the
 * squares say something to somebody not looking at them: a heatmap whose only
 * channel is colour is a heatmap for some of the room. So the tests are about
 * the accessible name, the keyboard, and the one cell whose state must never
 * be colour alone — the day that went over the ceiling.
 */

const day = (date: string, costEur: number, calls: number): DaySpend => ({
  day: date,
  calls,
  costEur,
  inputTokens: calls * 100,
  outputTokens: calls * 20,
  failures: 0,
  byTask: [],
  byModel: [],
});

const SERIES = [
  day("2026-03-02", 80, 900),
  day("2026-03-03", 2.5, 120),
  day("2026-03-04", 0.4, 30),
];

const grid = calendarGrid(SERIES, 2026, 50);

function setup(selected?: string) {
  const onSelect = vi.fn();
  render(<SpendHeatmap grid={grid} selected={selected} onSelect={onSelect} />);

  return { onSelect, user: userEvent.setup() };
}

describe("SpendHeatmap", () => {
  it("names each day with its figure, not with its shade", () => {
    setup();

    // "Level three of four" describes the component. This describes the day.
    expect(
      screen.getByRole("gridcell", { name: "Tue 3 Mar: €2.50 over 120 calls" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: "Thu 1 Jan: no calls" }),
    ).toBeInTheDocument();
  });

  it("says in words that a day went over the limit", () => {
    setup();

    // The alert colour is the signal for people who can see it. This is the
    // signal for everybody else, and it is on the cell itself.
    expect(
      screen.getByRole("gridcell", {
        name: "Mon 2 Mar: €80.00 over 900 calls, over the daily limit",
      }),
    ).toBeInTheDocument();
  });

  it("opens a day when it is clicked", async () => {
    const { onSelect, user } = setup();

    await user.click(
      screen.getByRole("gridcell", { name: /Tue 3 Mar/ }),
    );

    expect(onSelect).toHaveBeenCalledWith("2026-03-03");
  });

  it("keeps one tab stop for the whole grid", () => {
    setup("2026-03-03");

    const tabbable = screen
      .getAllByRole("gridcell")
      .filter((cell) => cell.getAttribute("tabindex") === "0");

    // 365 tab stops is not an accessible calendar, it is a calendar nobody
    // can tab past.
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("data-day", "2026-03-03");
  });

  it("walks the week with up and down, and the weeks with left and right", async () => {
    const { user } = setup("2026-03-03");

    await user.tab();
    expect(document.activeElement).toHaveAttribute("data-day", "2026-03-03");

    // Down is the next day, because the layout runs a week downward. A
    // keyboard that disagrees with the layout is worse than none.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("data-day", "2026-03-04");

    // Right is the next week: one column across is seven days on.
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toHaveAttribute("data-day", "2026-03-11");

    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(document.activeElement).toHaveAttribute("data-day", "2026-03-03");
  });

  it("does not walk off either end of the year", async () => {
    const { user } = setup("2026-01-01");

    await user.tab();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowUp}");

    expect(document.activeElement).toHaveAttribute("data-day", "2026-01-01");
  });

  it("shows the same readout on focus as on hover", async () => {
    const { user } = setup("2026-03-02");

    await user.tab();

    // Keyboard readers get the tooltip too, or the hover layer is a gate.
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("€80.00");
    expect(tooltip).toHaveTextContent("900 calls");
    expect(tooltip).toHaveTextContent("over the daily limit");
  });

  it("gives the ramp a legend, with the alert step labelled in words", () => {
    setup();

    expect(screen.getByText("Less")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
    expect(screen.getByText("Over the daily limit")).toBeInTheDocument();
  });
});
