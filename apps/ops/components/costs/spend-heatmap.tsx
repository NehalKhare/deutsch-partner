"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { eyebrow } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import {
  longDayLabel,
  type CalendarCell,
  type CalendarGrid,
} from "@/lib/spend-series";
import { formatCount, formatEur, heatFill } from "./format";

/**
 * A year of spend, one cell per day.
 *
 * Column-major — a week runs down, the year runs across — because the shape
 * worth seeing is *when* this got expensive, and a dark vertical band reads as
 * a costly week at a glance where a wall calendar reads as a wall calendar.
 *
 * Three things are doing the encoding and only one of them is colour. The
 * ramp carries magnitude, the tooltip carries the figure, and the day detail
 * below carries the breakdown — so the cell that matters most, the one over
 * the daily ceiling, is never a shade somebody has to have been told about.
 * It is the alert colour, it is named in the tooltip, and its accessible name
 * says so out loud.
 *
 * Keyboard: one tab stop for the whole grid and arrows inside it. Three
 * hundred and sixty-five tab stops is not an accessible calendar, it is a
 * calendar nobody can tab past.
 */

const WEEKDAY_ROWS = ["Mon", "", "Wed", "", "Fri", "", ""] as const;

export interface SpendHeatmapProps {
  readonly grid: CalendarGrid;
  readonly selected: string | undefined;
  readonly onSelect: (day: string) => void;
}

interface Hovered {
  readonly cell: CalendarCell;
  readonly x: number;
  readonly y: number;
}

export function SpendHeatmap({ grid, selected, onSelect }: SpendHeatmapProps) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // The roving tab stop: whatever is selected, else the newest day, so the
  // first arrow press lands somewhere the reader was already looking.
  const days = grid.days;
  const lastDay = days[days.length - 1]?.day;
  const roving = focusKey ?? selected ?? lastDay;

  const move = (from: string, delta: number) => {
    const index = days.findIndex((day) => day.day === from);
    const next = days[Math.min(days.length - 1, Math.max(0, index + delta))];
    if (!next) return;

    setFocusKey(next.day);
    container.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${next.day}"]`)
      ?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    // Down and up walk the week, left and right walk the weeks — which is what
    // the grid looks like, and a keyboard that disagrees with the layout is
    // worse than no keyboard support.
    const delta = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7 }[
      event.key
    ];
    if (delta === undefined) return;

    event.preventDefault();
    move(day, delta);
  };

  const show = (cell: CalendarCell, element: HTMLElement) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;

    const box = element.getBoundingClientRect();
    setHovered({
      cell,
      x: box.left - bounds.left + box.width / 2,
      y: box.top - bounds.top,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={container} className="relative overflow-x-auto pb-1">
        <div className="inline-flex min-w-full flex-col gap-1">
          {/* Month labels ride the column their first day falls in. */}
          <div className="flex gap-[3px] pl-9">
            {grid.weeks.map((week, column) => {
              const month = grid.months.find((entry) => entry.column === column);

              return (
                <div key={week.key} className="w-[13px] shrink-0">
                  {month ? (
                    <span
                      className={cn(eyebrow, "tracking-normal whitespace-nowrap")}
                    >
                      {month.label}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Three of seven rows are labelled. Seven is a wall of text beside
                a grid whose rows are already in a fixed, learnable order. */}
            <div className="flex w-9 shrink-0 flex-col gap-[3px] pr-1">
              {WEEKDAY_ROWS.map((label, row) => (
                <span
                  key={row}
                  aria-hidden={label === ""}
                  className={cn(
                    eyebrow,
                    "flex h-[13px] items-center justify-end tracking-normal",
                  )}
                >
                  {label}
                </span>
              ))}
            </div>

            <div
              role="grid"
              aria-label={`Daily AI spend for ${grid.year}`}
              className="flex gap-[3px]"
              onPointerLeave={() => setHovered(null)}
            >
              {grid.weeks.map((week) => (
                <div
                  key={week.key}
                  role="row"
                  className="flex flex-col gap-[3px]"
                >
                  {week.cells.map((cell, row) =>
                    cell === null ? (
                      <span
                        key={`${week.key}-${row}`}
                        role="gridcell"
                        aria-hidden
                        className="size-[13px]"
                      />
                    ) : (
                      <button
                        key={cell.day}
                        role="gridcell"
                        type="button"
                        data-day={cell.day}
                        tabIndex={cell.day === roving ? 0 : -1}
                        aria-label={describe(cell)}
                        aria-selected={cell.day === selected}
                        onClick={() => onSelect(cell.day)}
                        onFocus={(event) => {
                          setFocusKey(cell.day);
                          show(cell, event.currentTarget);
                        }}
                        onBlur={() => setHovered(null)}
                        onPointerEnter={(event) =>
                          show(cell, event.currentTarget)
                        }
                        onKeyDown={(event) => onKeyDown(event, cell.day)}
                        style={{
                          backgroundColor: heatFill(cell.level, cell.overLimit),
                        }}
                        className={cn(
                          "size-[13px] rounded-[3px] transition-[outline-color,transform]",
                          "outline outline-offset-0",
                          // The empty cell needs a drawn edge or it is a hole;
                          // a filled one needs none, because it has a fill.
                          cell.level === 0 && !cell.overLimit
                            ? "outline-edge/60"
                            : "outline-transparent",
                          // Selection is a ring rather than a colour change:
                          // the colour is spoken for, it means money.
                          cell.day === selected &&
                            "outline-2 outline-copy ring-2 ring-ground",
                          "hover:outline-2 hover:outline-copy/50",
                          "focus-visible:outline-2 focus-visible:outline-brand",
                        )}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {hovered ? (
          <div
            role="tooltip"
            style={{ left: hovered.x, top: hovered.y }}
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-lg border border-edge bg-raised px-2.5 py-1.5 shadow-lg shadow-shade/30"
          >
            {/* The value leads and the day follows: the reader already knows
                which cell they are pointing at. */}
            <span className="font-display text-sm font-semibold text-copy">
              {formatEur(hovered.cell.spend.costEur)}
            </span>
            <span className="ml-2 font-display text-xs text-copy/60">
              {formatCount(hovered.cell.spend.calls)} call
              {hovered.cell.spend.calls === 1 ? "" : "s"} ·{" "}
              {longDayLabel(hovered.cell.day)}
            </span>
            {hovered.cell.overLimit ? (
              <span className="ml-2 font-display text-xs font-semibold text-ember">
                over the daily limit
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <HeatLegend />
    </div>
  );
}

/**
 * What a cell says to a screen reader.
 *
 * The figure, not the step. "Level three of four" is a description of this
 * component; the reader wants a description of the day.
 */
function describe(cell: CalendarCell): string {
  const day = longDayLabel(cell.day);
  if (cell.spend.calls === 0) return `${day}: no calls`;

  return (
    `${day}: ${formatEur(cell.spend.costEur)} over ` +
    `${formatCount(cell.spend.calls)} call${cell.spend.calls === 1 ? "" : "s"}` +
    (cell.overLimit ? ", over the daily limit" : "")
  );
}

function HeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5">
        <span className={cn(eyebrow, "tracking-normal")}>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            aria-hidden
            style={{ backgroundColor: heatFill(level, false) }}
            className={cn(
              "size-[13px] rounded-[3px]",
              level === 0 && "outline outline-edge/60",
            )}
          />
        ))}
        <span className={cn(eyebrow, "tracking-normal")}>More</span>
      </div>

      {/* Reserved, and it comes with its words attached. A state that is only
          ever a colour is a state half the room cannot read. */}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          style={{ backgroundColor: heatFill(0, true) }}
          className="size-[13px] rounded-[3px]"
        />
        <span className={cn(eyebrow, "tracking-normal")}>Over the daily limit</span>
      </div>
    </div>
  );
}
