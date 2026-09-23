import { nullLogger, type Logger } from "@dp/observability/logger";

/**
 * Euro conversion.
 *
 * Providers bill in dollars and the product reports in euro, so every ledger
 * row converts once, at write time, and stores the result together with the
 * rate that produced it. Historical spend is never restated: last month's
 * figures were true at last month's rate, and recomputing them when the rate
 * moves would quietly rewrite a financial record.
 *
 * A call is never blocked on an FX lookup. If today's rate is missing the most
 * recent one carries forward and the row says so; if there has never been one,
 * the row records the exact dollars and declares itself unpriced rather than
 * inventing a euro figure.
 */

export interface FxRate {
  readonly eurPerUsd: number;
  readonly rateDate: string;
  readonly source: string;
  /** The rate is not today's. Carried forward, and flagged on every row. */
  readonly stale: boolean;
}

export interface StoredFxRate {
  readonly eurPerUsd: number;
  readonly rateDate: string;
  readonly source: string;
}

export interface FxRateStore {
  latestOnOrBefore(rateDate: string): Promise<StoredFxRate | null>;
}

export type FxWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: string };

/**
 * The other end of the store: what the daily snapshot job writes.
 *
 * Separate from the read side because the two have different callers and very
 * different privileges — every request reads a rate, and one scheduled job
 * writes one. Writing a day that already has a rate replaces it, so re-running
 * the job is the normal case rather than a duplicate.
 */
export interface FxRateSnapshots {
  save(rate: StoredFxRate): Promise<FxWriteResult>;
  /**
   * When the source was last read successfully — not the date it answered
   * with. The two differ every morning before the source publishes, and it is
   * this one that answers "have we already asked today".
   */
  lastFetchedAt(): Promise<Date | null>;
}

export interface FxRateService {
  resolve(onDate: Date): Promise<FxRate | null>;
}

export interface FxRateServiceOptions {
  readonly logger?: Logger;
  /**
   * Used only when the store has never held a rate. Configuration, so a cold
   * database prices its first calls instead of recording them as unpriced.
   * Always reported stale: it is not a snapshot of anything.
   */
  readonly bootstrap?: { readonly eurPerUsd: number; readonly source: string };
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The precision the ledger's numeric columns store. */
const SCALE = 1e8;

export function toEur(costUsd: number, rate: FxRate | null): number {
  if (rate === null) return 0;

  return Math.round(costUsd * rate.eurPerUsd * SCALE) / SCALE;
}

export function createFxRateService(
  store: FxRateStore,
  options: FxRateServiceOptions = {},
): FxRateService {
  const logger = options.logger ?? nullLogger;
  // One lookup per day, not one per call: a turn triggers several calls and
  // they all price at the same rate by definition.
  let cachedFor: string | null = null;
  let cached: FxRate | null = null;

  return {
    async resolve(onDate) {
      const today = isoDate(onDate);
      if (cachedFor === today) return cached;

      let stored: StoredFxRate | null = null;
      try {
        stored = await store.latestOnOrBefore(today);
      } catch (error) {
        // Never propagate: the routing document is explicit that FX must not
        // be able to block a call.
        logger.warn("fx.lookup_failed", {
          rateDate: today,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
      }

      const resolved: FxRate | null = stored
        ? { ...stored, stale: stored.rateDate !== today }
        : options.bootstrap
          ? { ...options.bootstrap, rateDate: today, stale: true }
          : null;

      cachedFor = today;
      cached = resolved;

      return resolved;
    },
  };
}
