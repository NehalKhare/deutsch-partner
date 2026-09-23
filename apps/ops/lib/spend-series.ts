/**
 * The spend series, and the four shapes a screen reads it in.
 *
 * Everything here is a pure function over a list of days. That is deliberate
 * and it is the cost-dashboard spec's S4 rule ("do not aggregate in React")
 * kept honest under a component that has to re-bucket on every tab press:
 * the bucketing is not in a component, it is in a module a node test can call
 * with a year of days and an assertion about the answer. The component picks
 * a timeframe and renders what comes back.
 *
 * Days are UTC and keyed `YYYY-MM-DD`, matching `cost_rollup_daily.day`.
 * Local time is not a thing a ledger has: a call is billed on the day the
 * provider says it was, and re-bucketing that by the operator's timezone
 * would make the same day cost two different amounts in two offices.
 */

/** The precision the ledger's numeric columns store. Rounding matches costs.ts. */
const SCALE = 1e8;

const round = (value: number) => Math.round(value * SCALE) / SCALE;

export interface DayModelSpend {
  readonly modelId: string;
  readonly calls: number;
  readonly costEur: number;
}

export interface DayTaskSpend {
  readonly task: string;
  readonly tier: string;
  readonly calls: number;
  readonly costEur: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * One day of the ledger, already rolled up.
 *
 * The same shape a `cost_rollup_daily` query returns grouped by day, so the
 * screen does not learn a shape that only the sample data has.
 */
export interface DaySpend {
  readonly day: string;
  readonly calls: number;
  readonly costEur: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly failures: number;
  readonly byTask: readonly DayTaskSpend[];
  readonly byModel: readonly DayModelSpend[];
}

export const TIMEFRAMES = ["calendar", "weekly", "monthly", "yearly"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_LABEL: Readonly<Record<Timeframe, string>> = {
  calendar: "Calendar",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

/**
 * What each tab is a window onto.
 *
 * A timeframe is a window *and* a bar width, not one or the other. Bucketing
 * a year into years draws a single bar, which is a stat tile wearing a chart's
 * costume; plotting a week as one bar loses the only thing a week view is for.
 * So: short windows keep daily bars, and the year steps up to months.
 */
export interface TimeframeShape {
  /** How many days back from the newest day in the series the window covers. */
  readonly days: number;
  readonly bucket: "day" | "month";
  /** Names the x-axis, and the caption under the chart. */
  readonly description: string;
}

export const TIMEFRAME_SHAPE: Readonly<Record<Exclude<Timeframe, "calendar">, TimeframeShape>> = {
  weekly: { days: 7, bucket: "day", description: "The last 7 days, one bar per day" },
  monthly: { days: 30, bucket: "day", description: "The last 30 days, one bar per day" },
  yearly: { days: 365, bucket: "month", description: "The last 12 months, one bar per month" },
};

// --- day keys ---------------------------------------------------------------

/** `YYYY-MM-DD` in UTC. Not `toISOString().slice(0, 10)` twice in two files. */
export function dayKey(date: Date): string {
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");

  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** The UTC midnight a `YYYY-MM-DD` key names. */
export function dayDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday is column zero: this product prices in euro and teaches German. */
const mondayIndex = (date: Date) => (date.getUTCDay() + 6) % 7;

// --- windowing --------------------------------------------------------------

const EMPTY_DAY = (day: string): DaySpend => ({
  day,
  calls: 0,
  costEur: 0,
  inputTokens: 0,
  outputTokens: 0,
  failures: 0,
  byTask: [],
  byModel: [],
});

/**
 * The newest day the series knows about.
 *
 * The window is measured back from the data rather than from `Date.now()`, so
 * a dashboard opened on a morning where the rollup job has not run yet shows
 * the last seven days that exist instead of six blanks and a Monday.
 */
export function latestDay(series: readonly DaySpend[]): string | undefined {
  return series.reduce<string | undefined>(
    (newest, entry) => (newest === undefined || entry.day > newest ? entry.day : newest),
    undefined,
  );
}

/**
 * The last `days` days, gaps filled.
 *
 * Filled, because a bar chart that simply omits the days nobody called a model
 * draws Friday next to Tuesday at even spacing and invites the reader to read
 * a three-day gap as one day. A zero day is data.
 */
export function windowOf(series: readonly DaySpend[], days: number): readonly DaySpend[] {
  const newest = latestDay(series);
  if (newest === undefined) return [];

  const byDay = new Map(series.map((entry) => [entry.day, entry]));
  const end = dayDate(newest).getTime();
  const out: DaySpend[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = dayKey(new Date(end - offset * DAY_MS));
    out.push(byDay.get(key) ?? EMPTY_DAY(key));
  }

  return out;
}

// --- bucketing --------------------------------------------------------------

export interface SpendBucket {
  readonly key: string;
  /** The x-axis tick. Short, because every bar carries one. */
  readonly label: string;
  /** What a tooltip says, where there is room for the whole truth. */
  readonly detail: string;
  readonly costEur: number;
  readonly calls: number;
  /**
   * The costliest single day inside the bucket.
   *
   * Carried so a chart can say whether a bucket contains a day that breached
   * the ceiling without the bucketing needing to know what the ceiling is.
   * For a day bucket it is the bucket's own total.
   */
  readonly maxDayEur: number;
  readonly days: readonly DaySpend[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** `Tue 12 Aug`, for a tooltip that has to name a day unambiguously. */
export function longDayLabel(key: string): string {
  const date = dayDate(key);

  return `${WEEKDAYS[mondayIndex(date)]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

const sum = (days: readonly DaySpend[], pick: (day: DaySpend) => number) =>
  round(days.reduce((total, day) => total + pick(day), 0));

/** A whole window as one bucket, for the bucket the day detail rolls up from. */
function toBucket(
  key: string,
  label: string,
  detail: string,
  days: readonly DaySpend[],
): SpendBucket {
  return {
    key,
    label,
    detail,
    costEur: sum(days, (day) => day.costEur),
    calls: days.reduce((total, day) => total + day.calls, 0),
    maxDayEur: days.reduce((most, day) => Math.max(most, day.costEur), 0),
    days,
  };
}

/**
 * The bars a timeframe draws.
 *
 * One bucket per day, or one per calendar month — never per year, and never a
 * rolling 30-day mean dressed up as a month. A reader comparing two bars has
 * to be comparing two equal spans of time or the comparison is a lie the chart
 * is telling on the data's behalf.
 */
export function bucketSeries(
  series: readonly DaySpend[],
  timeframe: Exclude<Timeframe, "calendar">,
): readonly SpendBucket[] {
  const shape = TIMEFRAME_SHAPE[timeframe];
  const days = windowOf(series, shape.days);

  if (shape.bucket === "day") {
    return days.map((day) => {
      const date = dayDate(day.day);

      // Seven bars can afford a weekday. Thirty can afford only the date —
      // except on the first of a month, where a bare "2" after a "29" reads
      // as going backwards and the month is the thing that explains it.
      const date_ = date.getUTCDate();
      const label =
        shape.days <= 7
          ? WEEKDAYS[mondayIndex(date)]!
          : date_ === 1
            ? MONTHS[date.getUTCMonth()]!
            : `${date_}`;

      return toBucket(day.day, label, longDayLabel(day.day), [day]);
    });
  }

  const months = new Map<string, DaySpend[]>();
  for (const day of days) {
    const key = day.day.slice(0, 7);
    const bucket = months.get(key);
    if (bucket) bucket.push(day);
    else months.set(key, [day]);
  }

  return [...months.entries()].map(([key, monthDays]) => {
    const month = MONTHS[Number(key.slice(5, 7)) - 1] ?? key;

    return toBucket(key, month, `${month} ${key.slice(0, 4)}`, monthDays);
  });
}

// --- the headline figures ---------------------------------------------------

export interface SpendSummary {
  readonly totalEur: number;
  readonly calls: number;
  /** The most expensive single day in the window, or undefined if none spent. */
  readonly peak: { readonly day: string; readonly costEur: number } | undefined;
  /** Over every day in the window, including the zero ones. They are days too. */
  readonly averageDailyEur: number;
  readonly dayCount: number;
}

/**
 * Total, peak and average over a window.
 *
 * The average divides by every day in the window rather than by the days that
 * happened to cost something. A quiet weekend is not missing data, and an
 * average that skips it answers "what does a busy day cost" while being
 * labelled "average daily cost" — which is the number somebody will multiply
 * by 365 to decide whether this product can ship.
 */
export function summarise(days: readonly DaySpend[]): SpendSummary {
  const totalEur = sum(days, (day) => day.costEur);
  const peak = days.reduce<SpendSummary["peak"]>(
    (best, day) =>
      day.costEur > 0 && (best === undefined || day.costEur > best.costEur)
        ? { day: day.day, costEur: day.costEur }
        : best,
    undefined,
  );

  return {
    totalEur,
    calls: days.reduce((total, day) => total + day.calls, 0),
    peak,
    averageDailyEur: days.length === 0 ? 0 : round(totalEur / days.length),
    dayCount: days.length,
  };
}

// --- the heat scale ---------------------------------------------------------

/** Four filled steps plus an empty one. Past ~5 classes adjacent cells blur. */
export const HEAT_LEVELS = [0, 1, 2, 3, 4] as const;
export type HeatLevel = (typeof HEAT_LEVELS)[number];

export interface HeatScale {
  /** Three cuts, ascending, splitting the spending days into four steps. */
  readonly thresholds: readonly [number, number, number];
  readonly max: number;
}

/**
 * Where to put the four cuts.
 *
 * Quartiles of the days that actually cost something, not equal slices of
 * nought-to-max. Spend is long-tailed — one day a backfill runs and costs
 * thirty times a Tuesday — and a linear scale anchored on that day paints the
 * entire rest of the year in step one, which is a year-long picture of
 * nothing. Quartiles keep the four steps populated, which is the only reason
 * to have four.
 *
 * The zero days stay out of the quantiles and get step zero. A day nobody
 * called a model on is not a cheap day, it is a different kind of day.
 */
export function heatScale(days: readonly DaySpend[]): HeatScale {
  const spent = days
    .map((day) => day.costEur)
    .filter((cost) => cost > 0)
    .sort((a, b) => a - b);

  if (spent.length === 0) return { thresholds: [0, 0, 0], max: 0 };

  const at = (fraction: number) =>
    spent[Math.min(spent.length - 1, Math.floor(fraction * spent.length))] ?? 0;

  return {
    thresholds: [at(0.25), at(0.5), at(0.75)],
    max: spent[spent.length - 1] ?? 0,
  };
}

/** Which of the five steps a day's spend lands on. */
export function heatLevel(costEur: number, scale: HeatScale): HeatLevel {
  if (costEur <= 0) return 0;
  if (costEur <= scale.thresholds[0]) return 1;
  if (costEur <= scale.thresholds[1]) return 2;
  if (costEur <= scale.thresholds[2]) return 3;

  return 4;
}

// --- the calendar grid ------------------------------------------------------

export interface CalendarCell {
  readonly day: string;
  readonly spend: DaySpend;
  readonly level: HeatLevel;
  /** Past the configured daily ceiling. A state, not a hotter shade of one. */
  readonly overLimit: boolean;
}

export interface CalendarWeek {
  readonly key: string;
  /** Seven slots, Monday first. `null` is a day outside the year. */
  readonly cells: readonly (CalendarCell | null)[];
}

export interface CalendarMonthLabel {
  readonly label: string;
  /** Which week column the month opens in, so the label sits over its block. */
  readonly column: number;
}

export interface CalendarGrid {
  readonly year: number;
  readonly weeks: readonly CalendarWeek[];
  readonly months: readonly CalendarMonthLabel[];
  readonly scale: HeatScale;
  readonly days: readonly DaySpend[];
}

/**
 * A year as columns of weeks.
 *
 * Column-major because that is what makes the shape readable: a week is a
 * vertical run of seven, months read left to right, and the eye picks out a
 * costly fortnight as a dark vertical band. Laid out row-major it is a wall
 * calendar, which answers "what date is that" — a question the reader already
 * knows the answer to — instead of "when did this get expensive".
 *
 * Leading and trailing nulls pad the first and last weeks so every column is
 * seven tall and the weekday rows stay aligned across the year.
 */
export function calendarGrid(
  series: readonly DaySpend[],
  year: number,
  dailyLimitEur: number,
): CalendarGrid {
  const byDay = new Map(series.map((entry) => [entry.day, entry]));
  const days: DaySpend[] = [];

  for (
    let cursor = Date.UTC(year, 0, 1);
    cursor < Date.UTC(year + 1, 0, 1);
    cursor += DAY_MS
  ) {
    const key = dayKey(new Date(cursor));
    days.push(byDay.get(key) ?? EMPTY_DAY(key));
  }

  const scale = heatScale(days);
  const weeks: CalendarWeek[] = [];
  const months: CalendarMonthLabel[] = [];
  let cells: (CalendarCell | null)[] = Array.from(
    { length: mondayIndex(dayDate(days[0]!.day)) },
    () => null,
  );

  for (const spend of days) {
    const date = dayDate(spend.day);

    // The label goes over the column the month *shows up* in, which is not
    // always the column holding its first day. A month opening on a Friday,
    // Saturday or Sunday owns two or three cells of that column and all seven
    // of the next, so labelling the first puts "Mar" over a column that is
    // five-sevenths February. The next column is where the month reads.
    if (date.getUTCDate() === 1) {
      months.push({
        label: MONTHS[date.getUTCMonth()]!,
        column: weeks.length + (mondayIndex(date) >= 4 ? 1 : 0),
      });
    }

    cells.push({
      day: spend.day,
      spend,
      level: heatLevel(spend.costEur, scale),
      overLimit: dailyLimitEur > 0 && spend.costEur >= dailyLimitEur,
    });

    if (cells.length === 7) {
      weeks.push({ key: `${year}-w${weeks.length}`, cells });
      cells = [];
    }
  }

  if (cells.length > 0) {
    weeks.push({
      key: `${year}-w${weeks.length}`,
      cells: [...cells, ...Array.from({ length: 7 - cells.length }, () => null)],
    });
  }

  return { year, weeks, months, scale, days };
}

// --- reading a day ----------------------------------------------------------

/** A day's models, most expensive first. The table under the calendar. */
export function modelsOf(day: DaySpend): readonly DayModelSpend[] {
  return [...day.byModel].sort((a, b) => b.costEur - a.costEur);
}

/** A day's tasks, most expensive first. */
export function tasksOf(day: DaySpend): readonly DayTaskSpend[] {
  return [...day.byTask].sort((a, b) => b.costEur - a.costEur);
}
