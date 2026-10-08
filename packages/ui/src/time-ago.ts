/**
 * A timestamp as a notification shows it: how long ago, in the coarsest unit
 * that is still honest, and the date once it is more than a week old.
 *
 * Pure, with the clock passed in, so a list rendered on the server and again
 * on the client agrees with itself and a test can pin the answer.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";

  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return new Date(at).toISOString().slice(0, 10);
}
