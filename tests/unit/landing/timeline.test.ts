import { describe, expect, it } from "vitest";

import { GUIDED_HOURS, monthsToFinish, timelinePhrase } from "@/lib/landing/timeline";

/**
 * The landing page's one set of numbers.
 *
 * A timeline on a marketing page is a claim, and this one is read ten
 * thousand times for every time somebody checks it — so the arithmetic and
 * the phrasing are pinned here, including the rule that rounding never
 * flatters: thirteen months is a year, twenty-three is two.
 */

describe("the guided hours", () => {
  it("are cumulative and increasing, because the levels nest", () => {
    expect(GUIDED_HOURS.A1).toBeLessThan(GUIDED_HOURS.A2);
    expect(GUIDED_HOURS.A2).toBeLessThan(GUIDED_HOURS.B1);
  });
});

describe("the arithmetic", () => {
  it("halves the calendar when the minutes double", () => {
    expect(monthsToFinish("A1", 60)).toBeCloseTo(monthsToFinish("A1", 30) / 2, 10);
  });

  it("reaches A1 in about six months at half an hour a day", () => {
    // 90 hours at 30 minutes a day is 180 days.
    expect(monthsToFinish("A1", 30)).toBeCloseTo(5.9, 1);
  });

  it("never divides by nobody practising", () => {
    expect(monthsToFinish("A1", 0)).toBe(Infinity);
    expect(timelinePhrase("A1", 0)).toBe("—");
  });
});

describe("what the page says", () => {
  it.each([
    ["A1", 30, "about 6 months"],
    ["A1", 60, "about 3 months"],
    ["A2", 30, "about a year"],
    ["A2", 60, "about 7 months"],
    ["B1", 30, "about two years"],
    ["B1", 60, "about a year"],
  ] as const)("%s at %s minutes a day reads as %s", (level, minutes, phrase) => {
    expect(timelinePhrase(level, minutes)).toBe(phrase);
  });

  it("rounds towards honesty, never towards the sale", () => {
    // Thirteen months must not become "12 months", and twenty-three must not
    // become "under two years".
    expect(timelinePhrase("A2", 30)).toBe("about a year");
    expect(timelinePhrase("B1", 30)).toBe("about two years");
  });
});
