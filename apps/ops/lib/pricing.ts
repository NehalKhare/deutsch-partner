import type { FxSnapshot, ModelPrice } from "@dp/db/pricing-repository";

/**
 * The pricing page's reading of the snapshots.
 *
 * Only comparisons between figures the worker fetched; nothing here holds a
 * figure of its own (the no-price-literal rule, AGENTS.md).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function snapshotAgeDays(fetched: Date, now: Date): number {
  return (now.getTime() - fetched.getTime()) / DAY_MS;
}

export interface PriceChange {
  /** "input +50%, output −10%" */
  readonly summary: string;
  /** Either side went up: the one that explains a step in spend. */
  readonly up: boolean;
  /** When the previous price was last seen. */
  readonly since: Date;
}

function side(label: string, now: number, before: number): { text: string; up: boolean } {
  if (before === 0) {
    return now === 0 ? { text: `${label} ±0%`, up: false } : { text: `${label} was free`, up: true };
  }

  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: `${label} ±0%`, up: false };

  return { text: `${label} ${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`, up: pct > 0 };
}

/** How the newest price differs from the last different one, or null if it never moved. */
export function priceChange(model: ModelPrice): PriceChange | null {
  const previous = model.previous;
  if (previous === null) return null;

  const input = side("input", model.inputUsdPerToken, previous.inputUsdPerToken);
  const output = side("output", model.outputUsdPerToken, previous.outputUsdPerToken);

  return {
    summary: `${input.text}, ${output.text}`,
    up: input.up || output.up,
    since: previous.fetchedAt,
  };
}

/** The signed move from the row before, to four places. */
export function rateChange(row: FxSnapshot, before: FxSnapshot | undefined): string {
  if (before === undefined) return "—";

  const delta = Math.round((row.rate - before.rate) * 1e4) / 1e4;
  if (delta === 0) return "±0";

  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(4)}`;
}
