"use client";

import { useState } from "react";

import { eyebrow } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import type { SpendBucket } from "@/lib/spend-series";
import { formatCount, formatEur } from "./format";

/**
 * Spend over a window, one bar per bucket.
 *
 * Drawn in HTML rather than SVG, for two reasons that both come down to the
 * bars being real elements: a `<button>` is a hit target and a focus stop
 * without any of it being reimplemented, and text in a scaled `viewBox`
 * scales with the plot, which is how a chart ends up with 9px axis labels on
 * a narrow screen and 20px ones on a wide one.
 *
 * One series, so no legend — the heading says what is plotted. One axis, and
 * calls live in the tooltip rather than on a second scale: two y-scales on one
 * plot invent a correlation out of where the author happened to put the
 * origin, and the answer is never "but it is obvious which line is which".
 */

export interface SpendChartProps {
  readonly buckets: readonly SpendBucket[];
  readonly caption: string;
  /** The daily ceiling, drawn as a rule when the buckets are days. */
  readonly limitEur?: number;
  /**
   * Opens a day in the detail panel. Only a bar that *is* one day can offer
   * it; a month bar has no single day to open, so it stays a read-only mark
   * rather than pretending to be pressable.
   */
  readonly onSelectDay?: (day: string) => void;
}

/** How tall the plot is. Fixed, and the axis band sits outside it. */
const PLOT = "h-56";

/**
 * The width one bar is allowed to claim, gutter included.
 *
 * Bars cap at 24px — a thick saturated block reads loud and childish at any
 * size — so a seven-bar week stretched across a wide screen would be seven
 * threads adrift in a field of gridline. Constraining the whole plot instead
 * keeps the bar-to-air ratio the same at seven bars and at thirty, and lets a
 * thirty-bar month still use the full width.
 */
const SLOT_PX = 56;

/** The y-axis gutter, matching `pl-14`. */
const GUTTER_PX = 56;

/**
 * Axis ticks on round numbers.
 *
 * A y-axis reading 0 / 2.7183 / 5.4366 is an axis nobody can use as a ruler,
 * which is the only thing a y-axis is for once the peak is directly labelled.
 */
export function niceTicks(max: number, count = 4): readonly number[] {
  if (max <= 0) return [0];

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].find((option) => option * magnitude >= rough) ?? 10;
  const size = step * magnitude;
  const top = Math.ceil(max / size) * size;
  const ticks: number[] = [];

  for (let value = 0; value <= top + size / 2; value += size) {
    ticks.push(Math.round(value * 1e8) / 1e8);
  }

  return ticks;
}

export function SpendChart({
  buckets,
  caption,
  limitEur,
  onSelectDay,
}: SpendChartProps) {
  const [active, setActive] = useState<string | null>(null);

  if (buckets.length === 0) {
    return <p className="font-body text-copy/45">No days in this window.</p>;
  }

  const peak = buckets.reduce((best, bucket) =>
    bucket.costEur > best.costEur ? bucket : best,
  );
  const ticks = niceTicks(peak.costEur);
  const top = ticks[ticks.length - 1] ?? 1;
  const scale = (value: number) => (top === 0 ? 0 : (value / top) * 100);

  // Every bar carrying a label is thirty labels nobody reads, so a stride
  // keeps the axis to roughly eight. Two exceptions, both about the reader
  // not losing their place:
  //
  // The first of a month is always labelled, because it is the bar where the
  // numbers restart and "29" followed by "2" reads as going backwards; and
  // the last bar is labelled because it is the one most likely to be looked
  // for. Both yield to a neighbour rather than collide with it — an axis
  // reading "22 23" is two labels doing one label's work.
  const stride = Math.max(1, Math.ceil(buckets.length / 8));
  const last = buckets.length - 1;
  const anchors = buckets.flatMap((bucket, index) =>
    /^\d+$/.test(bucket.label) ? [] : [index],
  );
  const xTicks = new Set<number>(anchors);
  const clear = (index: number) =>
    anchors.every((anchor) => Math.abs(anchor - index) > 1);

  for (let index = 0; index <= last; index += stride) {
    if (clear(index)) xTicks.add(index);
  }
  if (clear(last) && last % stride > stride / 2) xTicks.add(last);

  const labelled = (index: number) => xTicks.has(index);
  const hovered = buckets.find((bucket) => bucket.key === active);
  const overLimit = limitEur !== undefined && limitEur > 0 && limitEur <= top;

  return (
    <figure className="flex flex-col gap-3">
      <div
        className="relative pl-14"
        style={{ maxWidth: `${buckets.length * SLOT_PX + GUTTER_PX}px` }}
      >
        {/* Gridlines and their labels, behind the data and one step off the
            surface. Solid hairlines: a dashed grid reads as a threshold. */}
        <div aria-hidden className={cn("absolute inset-x-0 top-0 pl-14", PLOT)}>
          {ticks.map((tick) => (
            <div
              key={tick}
              style={{ bottom: `${scale(tick)}%` }}
              className="absolute inset-x-0 border-t border-edge/50"
            >
              <span
                className={cn(
                  eyebrow,
                  "absolute right-full -translate-y-1/2 pr-2 tabular-nums tracking-normal",
                )}
              >
                {formatEur(tick)}
              </span>
            </div>
          ))}

          {/* The ceiling the gateway actually gates on, so a bar near the top
              can be read against the thing that would have stopped it. */}
          {overLimit ? (
            <div
              style={{ bottom: `${scale(limitEur)}%` }}
              className="absolute inset-x-0 border-t border-ember/70"
            >
              <span className="absolute right-0 -top-4 font-display text-[0.7rem] font-medium text-ember">
                daily limit
              </span>
            </div>
          ) : null}
        </div>

        <div
          className={cn("relative flex items-end gap-[2px]", PLOT)}
          onPointerLeave={() => setActive(null)}
        >
          {buckets.map((bucket) => {
            const isPeak = bucket.key === peak.key && bucket.costEur > 0;
            // Only a day bar turns red. A month whose total happens to contain
            // one breached day is not itself a breach, and painting it as one
            // makes the alert colour mean two things.
            const breached =
              limitEur !== undefined &&
              limitEur > 0 &&
              bucket.days.length === 1 &&
              bucket.maxDayEur >= limitEur;

            const day = bucket.days.length === 1 ? bucket.days[0]?.day : undefined;
            const opens = day !== undefined && onSelectDay !== undefined;

            return (
              <button
                key={bucket.key}
                type="button"
                aria-label={`${bucket.detail}: ${formatEur(bucket.costEur)} over ${formatCount(bucket.calls)} calls`}
                onClick={opens ? () => onSelectDay(day) : undefined}
                onPointerEnter={() => setActive(bucket.key)}
                onFocus={() => setActive(bucket.key)}
                onBlur={() => setActive(null)}
                // The hit target is the whole column, not the painted pixels:
                // a quiet Sunday is four pixels tall and nobody can point at it.
                className={cn(
                  "group relative flex h-full flex-1 items-end justify-center rounded-sm",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  opens ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  style={{
                    height: `${Math.max(bucket.costEur > 0 ? 1.5 : 0, scale(bucket.costEur))}%`,
                    backgroundColor: breached ? "var(--ember)" : "var(--brand)",
                  }}
                  className={cn(
                    "w-full max-w-6 rounded-t-[4px] transition-opacity",
                    // Emphasis by de-emphasis: the hovered bar stays as it is
                    // and its neighbours step back, so nothing moves.
                    active !== null && active !== bucket.key
                      ? "opacity-45"
                      : "opacity-100",
                  )}
                />

                {isPeak ? (
                  <span
                    aria-hidden
                    style={{ bottom: `${scale(bucket.costEur)}%` }}
                    className="absolute left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap font-display text-[0.7rem] font-semibold text-copy"
                  >
                    {formatEur(bucket.costEur)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div aria-hidden className="mt-2 flex gap-[2px]">
          {buckets.map((bucket, index) => (
            <span
              key={bucket.key}
              className={cn(
                eyebrow,
                "min-w-0 flex-1 text-center tabular-nums tracking-normal",
              )}
            >
              {labelled(index) ? bucket.label : ""}
            </span>
          ))}
        </div>
      </div>

      {/* The readout, and nothing when there is nothing to read out. The
          caption used to restate the heading word for word underneath the
          chart, which is a line of furniture where the answer should be. The
          height is held so the plot does not jump as the pointer crosses it. */}
      <figcaption className="min-h-5">
        <span role="status" className="font-display text-sm">
          {hovered ? (
            <>
              <span className="font-semibold text-copy">
                {formatEur(hovered.costEur)}
              </span>
              <span className="text-copy/60">
                {" "}
                · {formatCount(hovered.calls)} call
                {hovered.calls === 1 ? "" : "s"} · {hovered.detail}
              </span>
            </>
          ) : (
            <span className="sr-only">{caption}</span>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
