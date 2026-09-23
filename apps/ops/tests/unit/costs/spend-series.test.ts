import { describe, expect, it } from "vitest";

import {
  bucketSeries,
  calendarGrid,
  dayKey,
  heatLevel,
  heatScale,
  latestDay,
  longDayLabel,
  summarise,
  windowOf,
  type DaySpend,
} from "@/lib/spend-series";

/**
 * The bucketing, asserted.
 *
 * This module exists so that the answers a tab gives are checkable, and these
 * are the checks. The interesting cases are all about days that are *not*
 * there: a window with a gap in it, a year that starts mid-week, a quarter of
 * the year nobody called a model on. Every one of them is a way a spend chart
 * can quietly tell the truth about the rows it has and a lie about the period.
 */

const day = (date: string, costEur: number, calls = 10): DaySpend => ({
  day: date,
  calls: costEur === 0 ? 0 : calls,
  costEur,
  inputTokens: calls * 100,
  outputTokens: calls * 20,
  failures: 0,
  byTask: [],
  byModel: [],
});

describe("day keys", () => {
  it("formats in UTC, not the machine's timezone", () => {
    // Late-evening UTC is the next day in some offsets and the previous day in
    // others. A ledger day must not depend on where the operator is sitting.
    expect(dayKey(new Date("2026-03-09T23:45:00.000Z"))).toBe("2026-03-09");
    expect(dayKey(new Date("2026-03-09T00:15:00.000Z"))).toBe("2026-03-09");
  });

  it("names a weekday Monday-first", () => {
    expect(longDayLabel("2026-09-21")).toBe("Mon 21 Sep");
    expect(longDayLabel("2026-09-27")).toBe("Sun 27 Sep");
  });
});

describe("windowOf", () => {
  const series = [
    day("2026-09-14", 1),
    // 15th and 16th missing: nobody called a model, so nothing was rolled up.
    day("2026-09-17", 3),
    day("2026-09-18", 4),
  ];

  it("fills the days the rollup has no row for", () => {
    const window = windowOf(series, 5);

    expect(window.map((entry) => entry.day)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
    // Filled, not dropped: a chart that omits them draws the 14th beside the
    // 17th and invites the reader to read a three-day gap as one day.
    expect(window[1]?.costEur).toBe(0);
    expect(window[1]?.calls).toBe(0);
  });

  it("measures back from the newest day in the data, not from now", () => {
    expect(latestDay(series)).toBe("2026-09-18");
    expect(windowOf(series, 2).map((entry) => entry.day)).toEqual([
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  it("reaches back before the series starts rather than returning fewer days", () => {
    const window = windowOf(series, 7);

    expect(window).toHaveLength(7);
    expect(window[0]?.day).toBe("2026-09-12");
  });

  it("is empty when the series is", () => {
    expect(windowOf([], 30)).toEqual([]);
  });
});

describe("bucketSeries", () => {
  const series = Array.from({ length: 70 }, (_, index) =>
    day(dayKey(new Date(Date.UTC(2026, 6, 1) + index * 86_400_000)), index + 1),
  );

  it("gives the weekly view one bar per day", () => {
    const buckets = bucketSeries(series, "weekly");

    expect(buckets).toHaveLength(7);
    expect(buckets.every((bucket) => bucket.days.length === 1)).toBe(true);
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue",
    ]);
  });

  it("gives the monthly view thirty daily bars", () => {
    expect(bucketSeries(series, "monthly")).toHaveLength(30);
  });

  it("gives the yearly view calendar months, not rolling thirties", () => {
    const buckets = bucketSeries(series, "yearly");

    // 365 days back from 8 September 2026 spans thirteen calendar months.
    expect(buckets.length).toBeGreaterThan(1);
    expect(buckets.every((bucket) => /^\d{4}-\d{2}$/.test(bucket.key))).toBe(true);

    // Each bucket is a whole calendar month of the window, so two bars are
    // comparable spans. A bar is only honest against its neighbour if it is.
    const august = buckets.find((bucket) => bucket.key === "2026-08");
    expect(august?.days).toHaveLength(31);
    expect(august?.label).toBe("Aug");
  });

  it("sums a bucket and remembers its costliest day", () => {
    const august = bucketSeries(series, "yearly").find(
      (bucket) => bucket.key === "2026-08",
    );

    // 1 July is day 1 at €1, so 1 August is €32 and 31 August is €62.
    expect(august?.maxDayEur).toBe(62);
    expect(august?.costEur).toBeCloseTo((32 + 62) * (31 / 2), 6);
  });
});

describe("summarise", () => {
  it("averages over every day in the window, not only the spending ones", () => {
    // Two days at €10 and eight at nothing. €2, not €10: somebody is going to
    // multiply this by 365 to decide whether the product ships.
    const days = [
      ...Array.from({ length: 8 }, (_, index) => day(`2026-09-0${index + 1}`, 0)),
      day("2026-09-09", 10),
      day("2026-09-10", 10),
    ];

    expect(summarise(days).averageDailyEur).toBe(2);
    expect(summarise(days).totalEur).toBe(20);
    expect(summarise(days).dayCount).toBe(10);
  });

  it("picks the costliest day as the peak", () => {
    const summary = summarise([
      day("2026-09-01", 3),
      day("2026-09-02", 11),
      day("2026-09-03", 7),
    ]);

    expect(summary.peak).toEqual({ day: "2026-09-02", costEur: 11 });
  });

  it("has no peak when nothing was spent", () => {
    // Rather than a €0 peak on an arbitrary day, which reads as a fact.
    expect(summarise([day("2026-09-01", 0)]).peak).toBeUndefined();
    expect(summarise([]).averageDailyEur).toBe(0);
  });
});

describe("heatScale", () => {
  it("cuts on quantiles of the spending days, not nought-to-max", () => {
    // One backfill day thirty times a normal one. On a linear scale every
    // other day in the year lands in step one and the picture says nothing.
    const days = [
      ...Array.from({ length: 40 }, (_, index) =>
        day(`2026-01-${`${(index % 28) + 1}`.padStart(2, "0")}`, 1 + (index % 4)),
      ),
      day("2026-03-01", 120),
    ];
    const scale = heatScale(days);
    const levels = days.map((entry) => heatLevel(entry.costEur, scale));

    expect(scale.max).toBe(120);
    // All four filled steps are actually used.
    expect(new Set(levels)).toEqual(new Set([1, 2, 3, 4]));
    expect(heatLevel(120, scale)).toBe(4);
  });

  it("keeps a day with no calls out of the ramp entirely", () => {
    const scale = heatScale([day("2026-01-01", 0), day("2026-01-02", 5)]);

    // Level zero, not level one: a day nobody called a model on is a different
    // kind of day from a cheap one, and the empty cell says so.
    expect(heatLevel(0, scale)).toBe(0);
    expect(heatLevel(5, scale)).toBe(1);
  });

  it("survives a window in which nothing was spent", () => {
    const scale = heatScale([day("2026-01-01", 0)]);

    expect(scale).toEqual({ thresholds: [0, 0, 0], max: 0 });
    expect(heatLevel(0, scale)).toBe(0);
  });
});

describe("calendarGrid", () => {
  const grid = calendarGrid([day("2026-03-02", 80), day("2026-03-03", 2)], 2026, 50);

  it("covers every day of the year, gaps filled", () => {
    expect(grid.days).toHaveLength(365);
    expect(grid.days[0]?.day).toBe("2026-01-01");
    expect(grid.days[364]?.day).toBe("2026-12-31");
  });

  it("pads the first week so the weekday rows stay aligned", () => {
    // 1 January 2026 is a Thursday, so Monday to Wednesday are outside the
    // year and must be holes rather than the last three days of December.
    const first = grid.weeks[0]!;

    expect(first.cells.slice(0, 3)).toEqual([null, null, null]);
    expect(first.cells[3]).toMatchObject({ day: "2026-01-01" });
    expect(grid.weeks.every((week) => week.cells.length === 7)).toBe(true);
  });

  it("puts each month label over the column the month reads in", () => {
    expect(grid.months).toHaveLength(12);
    expect(grid.months[0]).toEqual({ label: "Jan", column: 0 });

    // 1 March 2026 is a Sunday: it is the last cell of its column, so that
    // column is six-sevenths February and the label belongs on the next one.
    const march = grid.months[2]!;
    const labelled = grid.weeks[march.column]!.cells.filter(
      (cell) => cell?.day.startsWith("2026-03"),
    );

    expect(march.label).toBe("Mar");
    expect(labelled).toHaveLength(7);
  });

  it("labels a month that opens early in the week on its own first column", () => {
    // 1 April 2026 is a Wednesday, so its column is mostly April already and
    // pushing the label on would leave the block unlabelled at its start.
    const april = grid.months[3]!;

    expect(april.label).toBe("Apr");
    expect(grid.weeks[april.column]?.cells).toContainEqual(
      expect.objectContaining({ day: "2026-04-01" }),
    );
  });

  it("marks a day past the ceiling as over the limit, not merely as hot", () => {
    const cells = grid.weeks.flatMap((week) => week.cells);
    const breached = cells.find((cell) => cell?.day === "2026-03-02");
    const ordinary = cells.find((cell) => cell?.day === "2026-03-03");

    expect(breached?.overLimit).toBe(true);
    expect(ordinary?.overLimit).toBe(false);
  });

  it("treats a limit of zero as no limit rather than as everything breaching", () => {
    const unlimited = calendarGrid([day("2026-03-02", 80)], 2026, 0);
    const cell = unlimited.weeks
      .flatMap((week) => week.cells)
      .find((entry) => entry?.day === "2026-03-02");

    expect(cell?.overLimit).toBe(false);
  });

  it("lays a leap year out without losing 29 February", () => {
    const leap = calendarGrid([], 2028, 50);

    expect(leap.days).toHaveLength(366);
    expect(leap.days.some((entry) => entry.day === "2028-02-29")).toBe(true);
    expect(leap.weeks.every((week) => week.cells.length === 7)).toBe(true);
  });
});
