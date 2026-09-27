/**
 * Money and dates on the pricing and billing pages.
 *
 * Every amount arrives from Stripe, through the price mirror, as an integer in
 * minor units, and stays one until the moment it is printed. These functions
 * are that moment. They round in the reader's favour — a monthly equivalent
 * up, a saving down — because a price that flatters by a cent is a price that
 * was wrong (billing-and-plans-spec.md S11, PAngV).
 *
 * No price is written down here, and none can be: there is nothing to format
 * until billing_prices has been read.
 *
 * Pure and dependency-free, so a Client Component can format what the server
 * handed it.
 */

/** English, with the euro sign before the figure, as English speakers in the eurozone write it. */
const LOCALE = "en-IE";

function assertMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("an amount is a non-negative whole number of minor units");
  }
}

/**
 * How many minor units the currency has, as Intl knows it: two for the euro,
 * none for the yen. Stripe's minor units follow the same ISO 4217 table.
 */
function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat(LOCALE, { style: "currency", currency: currency.toUpperCase() })
      .resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** "€9.99" from 999 and "eur". Always with its cents, so prices side by side line up. */
export function formatMinor(amountMinor: number, currency: string): string {
  assertMinor(amountMinor);
  const digits = minorDigits(currency);

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}

/**
 * "9.99" from 999: the plain decimal a schema.org Offer's price wants.
 *
 * By string, not division, so the figure a crawler is given is exactly the
 * one Stripe holds and never 69.98999999999999.
 */
export function minorToDecimal(amountMinor: number, currency: string): string {
  assertMinor(amountMinor);
  const digits = minorDigits(currency);
  if (digits === 0) return String(amountMinor);

  const padded = String(amountMinor).padStart(digits + 1, "0");
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/**
 * A yearly price as a month of it, rounded up: shown beside the yearly
 * total, never instead of it, and never a cent below what a month costs.
 */
export function monthlyEquivalentMinor(yearMinor: number): number {
  assertMinor(yearMinor);
  return Math.ceil(yearMinor / 12);
}

/**
 * The whole percent saved by paying yearly rather than twelve months, rounded
 * down. Null when paying yearly saves nothing, so no badge claims a saving
 * that is not there.
 */
export function yearlySavingPercent(monthMinor: number, yearMinor: number): number | null {
  assertMinor(monthMinor);
  assertMinor(yearMinor);
  const twelveMonths = monthMinor * 12;
  if (twelveMonths === 0 || yearMinor >= twelveMonths) return null;

  const percent = Math.floor(((twelveMonths - yearMinor) * 100) / twelveMonths);
  return percent > 0 ? percent : null;
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "12 October 2026". The month in words, so nobody reads 10/12 the other way
 * round; in UTC, so which region the server runs in cannot move the day.
 */
export function formatBillingDate(date: Date): string {
  return DATE.format(date);
}
