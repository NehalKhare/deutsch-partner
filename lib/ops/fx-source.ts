import { z } from "zod";

/**
 * Where the euro rate comes from.
 *
 * The cost accounting converts every ledger row to euro at write time and
 * stores the rate it used — but nothing ever put a rate in the table for it to
 * find, so every row ever written declared itself unpriced and the spend
 * dashboard reported zero euro against real dollars. This is the missing half:
 * one named source, snapshotted daily, carried forward by the reader when the
 * source has not published yet.
 *
 * The source is the European Central Bank's daily reference rates. It is the
 * authority for a euro-reporting business, it needs no account and no key, and
 * it is the rate an auditor would expect to see behind a figure on the
 * dashboard. Nothing is sent to it: the feed is one public document.
 *
 * Note where this lives. It is not in lib/ai/gateway, which is where the rest
 * of the cost accounting sits, because inside lib/ai exactly four files may
 * open a connection and all four are model transports — a rule worth more than
 * the convenience of keeping the euro code together.
 */

/** Recorded on every rate row, and shown beside every figure it prices. */
export const FX_SOURCE = "ecb";

const FEED = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const FETCH_TIMEOUT_MS = 10_000;

/**
 * A cross rate between two major currencies lives comfortably inside this
 * band, and nothing that lands outside it is a euro-dollar rate — it is a
 * misparse that would otherwise misprice every call silently. Not a price and
 * not a default: no figure from here is ever used as a rate.
 */
const PLAUSIBLE = { low: 0.1, high: 10 } as const;

/** The feed's date, quoted as it published it, not the day we read it. */
const publishedOn = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/i;

/** The dollar line. The feed states dollars per euro; the ledger wants both. */
const dollarsPerEuro = /<Cube\s+currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/i;

export interface FxSnapshot {
  readonly eurPerUsd: number;
  /** ISO date, from the feed. What makes a carried-forward rate legible. */
  readonly rateDate: string;
  readonly source: string;
}

const snapshotSchema = z.object({
  eurPerUsd: z.number().positive().gt(PLAUSIBLE.low).lt(PLAUSIBLE.high),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  source: z.string().min(1),
});

/**
 * The euro-per-dollar rate the feed implies.
 *
 * Inverted here rather than at the call site: the feed is quoted the other way
 * round from the way this product bills, and an inversion that happens in two
 * places is an inversion that will happen in one of them twice.
 */
export function parseEcbDailyFeed(xml: string): FxSnapshot | null {
  const day = publishedOn.exec(xml)?.[1];
  const quoted = Number(dollarsPerEuro.exec(xml)?.[1]);

  if (day === undefined || !Number.isFinite(quoted) || quoted <= 0) return null;

  const parsed = snapshotSchema.safeParse({
    eurPerUsd: 1 / quoted,
    rateDate: day,
    source: FX_SOURCE,
  });

  return parsed.success ? parsed.data : null;
}

/**
 * Reads today's rate, or null.
 *
 * Null rather than a throw, and never a substitute figure: a snapshot job that
 * cannot reach its source has not learned anything, and the reader already
 * knows how to carry the last known rate forward and say that it did.
 */
export async function fetchEurPerUsd(
  fetchImpl: typeof fetch = fetch,
): Promise<FxSnapshot | null> {
  try {
    const response = await fetchImpl(FEED, {
      headers: { accept: "application/xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    return parseEcbDailyFeed(await response.text());
  } catch {
    return null;
  }
}
