/**
 * Pre-flight and fallback cost estimation.
 *
 * The authoritative figure is what the provider reports for the generation it
 * actually ran; that is what a ledger row prefers. This module covers the two
 * cases where there is no such figure: estimating before dispatch so the
 * budget gate can count the call it is gating, and pricing a provider that
 * does not return cost inline.
 *
 * Rates are snapshots read from the database with a fetched_at stamp, never
 * literals. A number written into code is a number that stops being true
 * without anything failing.
 */

export interface ModelRate {
  readonly provider: string;
  readonly modelId: string;
  /** Dollars per input token, as snapshotted from the provider's model list. */
  readonly inputRate: number;
  /** Dollars per output token, from the same snapshot. */
  readonly outputRate: number;
  readonly currency: string;
  readonly fetchedAt: Date;
}

export interface PricingStore {
  latestFor(provider: string, modelId: string): Promise<ModelRate | null>;
}

/** A snapshot older than this is reported stale; the refresh job runs daily. */
export const RATE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function isRateStale(rate: ModelRate, now: Date): boolean {
  return now.getTime() - rate.fetchedAt.getTime() > RATE_STALE_AFTER_MS;
}

export function estimateUsd(
  rate: ModelRate | null,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): number | null {
  // Null, not zero. A missing price is unknown, and zero would exempt the
  // model from every budget it ought to count against.
  if (rate === null) return null;
  if (rate.currency !== "USD") return null;

  return usage.inputTokens * rate.inputRate + usage.outputTokens * rate.outputRate;
}

/** Looks a rate up without letting a store failure reach the dispatch path. */
export async function resolveRate(
  store: PricingStore,
  provider: string,
  modelId: string,
): Promise<ModelRate | null> {
  try {
    return await store.latestFor(provider, modelId);
  } catch {
    return null;
  }
}
