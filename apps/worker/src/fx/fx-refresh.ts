import { isoDate, type FxRateSnapshots } from "@dp/gateway/fx";
import { fetchEurPerUsd, type FxSnapshot } from "./fx-source";
import { nullLogger, type Logger } from "@dp/observability/logger";

/**
 * How often the rate is actually fetched.
 *
 * Once a day, and the guard is when the source was last *read* rather than
 * which date it answered with. Those differ every morning: the reference rate
 * for a day is published in the afternoon, so a request before then is
 * answered with yesterday's date, and a job that asked "do we have today's
 * rate yet" would ask again on every page view until the afternoon.
 *
 * A day means a UTC day, which is what the ledger's dates mean too.
 *
 * Nothing here can fail a caller. A source that cannot be reached leaves the
 * last known rate in place, which the reader already knows how to carry
 * forward and to flag; a page that showed an error instead would be reporting
 * an outage in a currency feed as an outage in the product.
 */

export interface DailyRateDeps {
  readonly snapshots: FxRateSnapshots;
  /** The source. Injected so a test never reaches the network. */
  readonly fetchRate?: () => Promise<FxSnapshot | null>;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

export type RateRefresh =
  /** Read from the source just now and stored. */
  | { readonly status: "fetched"; readonly rate: FxSnapshot }
  /** The source was already read today; nothing was asked of it. */
  | { readonly status: "asked_today" }
  /** The source could not be read. The last known rate stands. */
  | { readonly status: "unavailable" }
  | { readonly status: "not_stored"; readonly detail: string };

export async function ensureDailyRate(
  deps: DailyRateDeps,
  options: { readonly force?: boolean } = {},
): Promise<RateRefresh> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? nullLogger;
  const read = deps.fetchRate ?? (() => fetchEurPerUsd());

  if (options.force !== true) {
    const asked = await deps.snapshots.lastFetchedAt();
    if (asked !== null && isoDate(asked) === isoDate(now())) {
      return { status: "asked_today" };
    }
  }

  const rate = await read();
  if (rate === null) {
    logger.warn("fx.source_unavailable", { forced: options.force === true });
    return { status: "unavailable" };
  }

  const written = await deps.snapshots.save(rate);
  if (!written.ok) {
    logger.error("fx.snapshot_write_failed", { detail: written.detail });
    return { status: "not_stored", detail: written.detail };
  }

  logger.info("fx.snapshot_stored", {
    rateDate: rate.rateDate,
    source: rate.source,
    forced: options.force === true,
  });

  return { status: "fetched", rate };
}
