import { describe, expect, it } from "vitest";

import {
  formatBillingDate,
  formatMinor,
  minorToDecimal,
  monthlyEquivalentMinor,
  yearlySavingPercent,
} from "@/lib/billing/format";

/**
 * Money as a learner reads it, and as a crawler reads it.
 *
 * Every amount arrives from Stripe as an integer in minor units. These are
 * the only places it becomes a figure with a decimal point, so rounding that
 * flatters — a monthly equivalent shown a cent low, a saving shown a point
 * high — is pinned here rather than noticed by a customer.
 */

describe("formatMinor", () => {
  it("writes euro cents as euros, the symbol first", () => {
    expect(formatMinor(999, "eur")).toBe("€9.99");
    expect(formatMinor(13999, "eur")).toBe("€139.99");
  });

  it("keeps the cents on a whole amount, so two prices side by side line up", () => {
    expect(formatMinor(1000, "eur")).toBe("€10.00");
    expect(formatMinor(0, "eur")).toBe("€0.00");
  });

  it("groups thousands", () => {
    expect(formatMinor(123456, "eur")).toBe("€1,234.56");
  });

  it("knows a currency with no minor unit", () => {
    // Stripe sends yen as whole yen. Dividing by a hundred would be a
    // hundredfold discount.
    expect(formatMinor(1500, "jpy")).toMatch(/¥1,500$/);
  });

  it("accepts the code in either case, as Stripe and Intl spell it differently", () => {
    expect(formatMinor(999, "EUR")).toBe(formatMinor(999, "eur"));
  });

  it("refuses an amount that is not a whole number of minor units", () => {
    expect(() => formatMinor(9.99, "eur")).toThrow(RangeError);
    expect(() => formatMinor(-1, "eur")).toThrow(RangeError);
  });
});

describe("minorToDecimal", () => {
  it("is the plain decimal a schema.org price wants, with no symbol or grouping", () => {
    expect(minorToDecimal(999, "eur")).toBe("9.99");
    expect(minorToDecimal(123456, "eur")).toBe("1234.56");
  });

  it("pads amounts under one unit", () => {
    expect(minorToDecimal(5, "eur")).toBe("0.05");
    expect(minorToDecimal(0, "eur")).toBe("0.00");
  });

  it("does it with strings, not floating point", () => {
    // 0.1 + 0.2 is the reason. A decimal price computed by division can come
    // out as 69.98999999999999.
    expect(minorToDecimal(6999, "eur")).toBe("69.99");
    expect(minorToDecimal(1500, "jpy")).toBe("1500");
  });
});

describe("monthlyEquivalentMinor", () => {
  it("rounds up, so a month is never shown cheaper than it is", () => {
    // 69.99 / 12 = 5.8325
    expect(monthlyEquivalentMinor(6999)).toBe(584);
  });

  it("is exact when the year divides evenly", () => {
    expect(monthlyEquivalentMinor(12000)).toBe(1000);
  });
});

describe("yearlySavingPercent", () => {
  it("compares a year of monthly payments with the yearly price, rounding down", () => {
    // 12 × 9.99 = 119.88; 69.99 saves 49.89, which is 41.6%.
    expect(yearlySavingPercent(999, 6999)).toBe(41);
  });

  it("claims no saving when there is none", () => {
    expect(yearlySavingPercent(999, 11988)).toBeNull();
    expect(yearlySavingPercent(999, 20000)).toBeNull();
  });

  it("claims no saving it cannot compute", () => {
    expect(yearlySavingPercent(0, 0)).toBeNull();
  });
});

describe("formatBillingDate", () => {
  it("writes the day, the month in words and the year, so no reader swaps day and month", () => {
    expect(formatBillingDate(new Date("2026-10-12T09:30:00Z"))).toBe("12 October 2026");
  });

  it("reads the instant in UTC, so the server's own zone cannot move the day", () => {
    expect(formatBillingDate(new Date("2026-10-12T23:59:00Z"))).toBe("12 October 2026");
  });
});
