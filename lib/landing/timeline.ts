import type { CEFRLevel } from "@/domain/cefr";

/**
 * How long the path takes, honestly.
 *
 * The landing page promises a timeline, and a timeline is a claim — so the
 * numbers are the ones language schools already plan courses around rather
 * than ours: roughly 90 guided hours to finish A1, 200 cumulative to finish
 * A2, 350 to finish B1 (the Goethe-Institut plans 80–200 45-minute units per
 * level; these sit in the middle of that band). Daily minutes turn those into
 * calendar time by division and rounding, nothing else.
 *
 * Computed rather than written into the page, so the two paces can never
 * drift apart from each other or from the hours they claim to be based on —
 * and so the arithmetic is testable, because "about two years" is exactly the
 * kind of number that gets typed wrong once and read ten thousand times.
 */

/** Cumulative guided hours to finish each level, starting from nothing. */
export const GUIDED_HOURS: Readonly<Record<CEFRLevel, number>> = {
  A1: 90,
  A2: 200,
  B1: 350,
};

const DAYS_PER_MONTH = 30.4;

/**
 * Calendar months of daily practice to reach the level, unrounded.
 *
 * Every day counts, because the practice is at home: no commute, no
 * timetable, and a session is whatever half hour the day had spare.
 */
export function monthsToFinish(level: CEFRLevel, minutesPerDay: number): number {
  if (minutesPerDay <= 0) return Infinity;

  const days = (GUIDED_HOURS[level] * 60) / minutesPerDay;
  return days / DAYS_PER_MONTH;
}

/**
 * The months as a person would say them.
 *
 * Rounded to the nearest honest phrase, never down to a flattering one:
 * thirteen months is "about a year", not "12 months", and twenty-three is
 * "about two years", not "under two years".
 */
export function timelinePhrase(level: CEFRLevel, minutesPerDay: number): string {
  const months = monthsToFinish(level, minutesPerDay);

  if (!Number.isFinite(months)) return "—";
  if (months < 9.5) return `about ${Math.round(months)} months`;
  if (months < 14.5) return "about a year";
  if (months < 20.5) return "about a year and a half";
  if (months < 27.5) return "about two years";
  return `about ${Math.round(months / 12)} years`;
}
