"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { card, eyebrow, prose, sectionTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import {
  bucketSeries,
  calendarGrid,
  dayKey,
  longDayLabel,
  summarise,
  windowOf,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  TIMEFRAME_SHAPE,
  type DaySpend,
  type Timeframe,
} from "@/lib/spend-series";
import { formatCount, formatEur } from "./format";
import { DayDetail } from "./day-detail";
import { SpendChart } from "./spend-chart";
import { SpendHeatmap } from "./spend-heatmap";

/**
 * The spend explorer.
 *
 * Four windows onto one series: a year as a calendar, and three chart windows
 * of increasing span. The series is fetched once, on the server, and every tab
 * is a pure re-bucketing of it — no tab is a round trip, because a dashboard
 * whose timeframe control costs a query is a dashboard people stop changing
 * the timeframe on.
 *
 * The bucketing itself lives in `lib/spend-series`, not here. The spec's rule
 * is that aggregation is not a React concern, and the reason survives the
 * move from a server query to a client tab: what makes an aggregate
 * trustworthy is that something asserts it, and a `useMemo` is not somewhere
 * a test can reach.
 */

export interface SpendExplorerProps {
  readonly series: readonly DaySpend[];
  /** Configured per deployment; the gateway gates on the same number. */
  readonly dailyLimitEur: number;
  /** Drives the calendar's year and the window's end. Injected so tests can fix it. */
  readonly asOf: Date;
}

export function SpendExplorer({ series, dailyLimitEur, asOf }: SpendExplorerProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("calendar");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const grid = useMemo(
    () => calendarGrid(series, asOf.getUTCFullYear(), dailyLimitEur),
    [series, asOf, dailyLimitEur],
  );

  // What the three figures at the top are figures *of*. The calendar's window
  // is the year *so far*; a chart's is its own span. Nothing below the tabs is
  // ever scoped differently from the tab that is showing.
  //
  // So far, not the whole year: the grid draws all twelve months because that
  // is the shape of a calendar, but a day that has not happened is not a day
  // that cost nothing. Averaging over it divides a real total by ninety-nine
  // days that could not have spent anything, and the headline the product is
  // judged on — average daily cost — comes out a third too low.
  const windowDays = useMemo(() => {
    if (timeframe !== "calendar") {
      return windowOf(series, TIMEFRAME_SHAPE[timeframe].days);
    }

    const today = dayKey(asOf);

    return grid.days.filter((day) => day.day <= today);
  }, [timeframe, grid, series, asOf]);

  const summary = useMemo(() => summarise(windowDays), [windowDays]);

  const buckets = useMemo(
    () => (timeframe === "calendar" ? [] : bucketSeries(series, timeframe)),
    [timeframe, series],
  );

  // Nothing selected yet means the newest day that actually has calls on it,
  // so the panel opens with something in it rather than an instruction.
  //
  // The newest day in the window is the wrong default on the calendar tab:
  // that window is the whole year including the part of it that has not
  // happened, so it would open on 31 December and report no calls — which
  // looks like a product nobody used rather than a year not over yet.
  const openDay =
    windowDays.find((day) => day.day === selectedDay) ?? newestWithCalls(windowDays);

  // Nothing in the rollup at all is its own state, and it is not a year of
  // zeroes. A calendar painted 365 days of "nothing spent" is a claim about
  // the product; an empty rollup is a claim about the rollup, and the two
  // have completely different fixes.
  if (series.length === 0) return <NothingRolledUp />;

  return (
    <div className="flex flex-col gap-6">
      <Timeframes value={timeframe} onChange={setTimeframe} />

      <dl className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Total spend"
          value={formatEur(summary.totalEur)}
          note={`${formatCount(summary.calls)} calls over ${summary.dayCount} days`}
        />
        <Metric
          label="Peak usage day"
          value={summary.peak ? formatEur(summary.peak.costEur) : "€0"}
          note={summary.peak ? longDayLabel(summary.peak.day) : "Nothing spent"}
          tone={
            summary.peak && dailyLimitEur > 0 && summary.peak.costEur >= dailyLimitEur
              ? "alert"
              : "normal"
          }
        />
        <Metric
          label="Average daily cost"
          value={formatEur(summary.averageDailyEur)}
          // Said, because somebody will multiply this by 365, and an average
          // that skipped the quiet days would make that multiplication wrong.
          note="Across every day in the window, quiet ones included"
        />
      </dl>

      <section aria-labelledby="explorer-heading" className={cn(card, "flex flex-col gap-4")}>
        <h2 id="explorer-heading" className={sectionTitle}>
          {timeframe === "calendar"
            ? `Daily spend, ${grid.year}`
            : `Spend, ${TIMEFRAME_SHAPE[timeframe].description.toLowerCase()}`}
        </h2>

        {timeframe === "calendar" ? (
          <SpendHeatmap
            grid={grid}
            selected={openDay?.day}
            onSelect={setSelectedDay}
          />
        ) : (
          <SpendChart
            buckets={buckets}
            caption={TIMEFRAME_SHAPE[timeframe].description}
            limitEur={
              TIMEFRAME_SHAPE[timeframe].bucket === "day" ? dailyLimitEur : undefined
            }
            onSelectDay={setSelectedDay}
          />
        )}
      </section>

      {openDay ? <DayDetail day={openDay} limitEur={dailyLimitEur} /> : null}
    </div>
  );
}

/** The last day in the window anybody called a model on. */
function newestWithCalls(days: readonly DaySpend[]): DaySpend | undefined {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (day && day.calls > 0) return day;
  }

  return days[days.length - 1];
}

/**
 * The timeframe tabs.
 *
 * A real tablist: arrows move between tabs, one tab stop for the set, and the
 * selected tab is marked by `aria-selected` rather than only by being a
 * different colour. Four buttons that happen to sit in a row are not tabs to
 * anybody not looking at them.
 */
function Timeframes({
  value,
  onChange,
}: {
  readonly value: Timeframe;
  readonly onChange: (next: Timeframe) => void;
}) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    const index = TIMEFRAMES.indexOf(value);
    const next = TIMEFRAMES[(index + delta + TIMEFRAMES.length) % TIMEFRAMES.length]!;
    onChange(next);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <div
      ref={list}
      role="tablist"
      aria-label="Timeframe"
      className="inline-flex w-fit gap-1 rounded-full border border-edge/70 bg-panel/60 p-1"
    >
      {TIMEFRAMES.map((timeframe) => {
        const selected = timeframe === value;

        return (
          <button
            key={timeframe}
            type="button"
            role="tab"
            data-tab={timeframe}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(timeframe)}
            onKeyDown={onKeyDown}
            className={cn(
              "rounded-full px-4 py-1.5 font-display text-sm transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              selected
                ? "bg-brand font-semibold text-on-accent focus-visible:outline-on-accent"
                : "text-copy/65 hover:bg-panel hover:text-copy focus-visible:outline-brand",
            )}
          >
            {TIMEFRAME_LABEL[timeframe]}
          </button>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone = "normal",
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly tone?: "normal" | "alert";
}) {
  return (
    <div className={cn(card, "flex flex-col gap-1")}>
      <dt className={eyebrow}>{label}</dt>
      <dd className="flex flex-col gap-0.5">
        {/* Proportional figures on a standalone value; the same sans as the
            rest of the chrome, never the serif. */}
        <span
          className={cn(
            "font-display text-3xl font-semibold leading-none",
            tone === "alert" ? "text-ember" : "text-copy",
          )}
        >
          {value}
        </span>
        <span className="font-display text-xs text-copy/55">{note}</span>
      </dd>
    </div>
  );
}

/**
 * What the year looks like before anything has been rolled up.
 *
 * A sentence rather than a drawing. The temptation is to render the calendar
 * anyway, all 365 cells empty, so the screen keeps its shape — but an empty
 * grid is indistinguishable from a product nobody used, and those two states
 * have nothing in common except how they look. This one is fixed by running
 * a job; the other is fixed by finding some learners.
 */
function NothingRolledUp() {
  return (
    <div className={cn(card, "flex flex-col gap-2")}>
      <h2 className={sectionTitle}>No daily history yet</h2>
      <p className={prose}>
        The daily rollup holds nothing, so there is no year to draw. It fills
        in once the <code className="font-mono text-sm">cost.rollup</code> job
        has run and the ledger has calls in it — the job rebuilds each day from{" "}
        <code className="font-mono text-sm">model_invocations</code> on the
        hour, and backfills the whole ledger the first time it runs.
      </p>
      <p className={prose}>
        Today&rsquo;s figures do not depend on it. They are under
        &ldquo;Last 24 hours&rdquo;, below, and come straight from the ledger.
      </p>
    </div>
  );
}
