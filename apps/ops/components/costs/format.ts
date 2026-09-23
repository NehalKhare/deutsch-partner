/**
 * How money and counts are written on this screen.
 *
 * One module, because the same figure appears as a headline, as an axis tick,
 * in a tooltip and in a table cell, and four call sites rounding it four ways
 * is how a dashboard ends up disagreeing with itself.
 */

/**
 * Euro, at a precision that suits the size of the number.
 *
 * Sub-euro spend is the normal case for a single task on a single day, and
 * `€0.00` for four days running is a table reporting that nothing happened.
 * Above a euro the extra digits are noise, so they go.
 */
export function formatEur(value: number): string {
  if (value === 0) return "€0";
  if (value < 0.01) return `€${value.toFixed(4)}`;
  if (value < 1) return `€${value.toFixed(3)}`;

  return `€${value.toLocaleString("en-IE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Thousands-separated. Axis ticks and call counts. */
export const formatCount = (value: number): string => value.toLocaleString("en-IE");

/** 1.2M / 84.3K / 912 — for token counts, which run to eight figures. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;

  return `${value}`;
}

/**
 * The heatmap's four filled steps, as CSS.
 *
 * One hue, light to dark, mixed from the theme's own accent into the surface
 * the cells sit on — so the ramp inverts by itself on the dark theme (where
 * the accent is the lighter of the two) and takes the operator app's blue or
 * the learner app's apricot without this file naming either.
 *
 * The four stops are not eyeballed. They are the set that clears a monotone
 * lightness check, a 0.06 minimum step between neighbours, a 2:1 contrast
 * floor for the faintest step against its surface, and a one-hue spread —
 * in all four combinations of the two palettes and the two themes. Moving a
 * stop breaks at least one of those, so move them together or not at all.
 */
const HEAT_MIX = [55, 70, 85, 100] as const;

export function heatFill(level: number, overLimit: boolean): string {
  if (overLimit) return "var(--ember)";
  if (level <= 0) return "var(--panel)";

  const mix = HEAT_MIX[Math.min(level, HEAT_MIX.length) - 1];

  return `color-mix(in oklab, var(--brand) ${mix}%, var(--panel))`;
}

/**
 * A per-token dollar figure, per million tokens.
 *
 * Providers publish per token, and 0.000003 is a number nobody can compare at
 * a glance with 0.0000005. Per million is how the price lists are read.
 */
export function formatPerMillion(usdPerToken: number): string {
  const perMillion = usdPerToken * 1_000_000;
  if (perMillion === 0) return "$0";

  return `$${perMillion.toLocaleString("en-IE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: perMillion < 0.1 ? 4 : 2,
  })}`;
}

/** When something happened, in UTC, because that is when the counters reset. */
export function formatUtc(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
