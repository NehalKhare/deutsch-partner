import { describe, expect, it } from "vitest";

import { timeAgo } from "../src/time-ago";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("timeAgo", () => {
  it("says just now under a minute, then minutes, hours and days", () => {
    expect(timeAgo(ago(10_000), NOW)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe("5 min ago");
    expect(timeAgo(ago(60 * 60_000), NOW)).toBe("1 hour ago");
    expect(timeAgo(ago(3 * 3_600_000), NOW)).toBe("3 hours ago");
    expect(timeAgo(ago(24 * 3_600_000), NOW)).toBe("1 day ago");
    expect(timeAgo(ago(6 * 86_400_000), NOW)).toBe("6 days ago");
  });

  it("gives the date once it is a week old, and nothing for a time it cannot read", () => {
    expect(timeAgo(ago(8 * 86_400_000), NOW)).toBe("2026-09-30");
    expect(timeAgo("not a time", NOW)).toBe("");
  });

  it("never says the future", () => {
    expect(timeAgo(new Date(NOW + 60_000).toISOString(), NOW)).toBe("just now");
  });
});
