import { describe, expect, it } from "vitest";

import type { NotificationItem } from "@dp/domain/notifications";

import { EMPTY_FEED, feedFrom, markTargetFromForm, markTargetSchema } from "@/lib/notifications/feed";

const item = (id: string, readAt: string | null = null): NotificationItem => ({
  id,
  kind: "level.advanced",
  severity: "success",
  title: "t",
  body: "b",
  href: null,
  createdAt: "2026-10-08T10:00:00.000Z",
  readAt,
});

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = () => ({ ok: false as const, error: { kind: "unavailable" as const, message: "no", name: "RepositoryError" } as never });

describe("the feed", () => {
  it("is the list and the count when both read", () => {
    expect(feedFrom(ok([item("a"), item("b", "2026-10-08T11:00:00.000Z")]), ok(7))).toEqual({
      unread: 7,
      items: [item("a"), item("b", "2026-10-08T11:00:00.000Z")],
    });
  });

  it("counts what it can see when the count could not be read: a floor, not a guess", () => {
    expect(feedFrom(ok([item("a"), item("b", "2026-10-08T11:00:00.000Z")]), fail()).unread).toBe(1);
  });

  it("is empty when the list could not be read, whatever the count said", () => {
    // An unreadable store must not put a number on the bell.
    expect(feedFrom(fail(), ok(9))).toEqual(EMPTY_FEED);
  });
});

describe("what may be marked", () => {
  it("is everything, or a bounded list of ids; the repository checks the ids themselves", () => {
    expect(markTargetSchema.safeParse("all").success).toBe(true);
    expect(markTargetSchema.safeParse(["11111111-1111-4111-8111-111111111111"]).success).toBe(true);
    expect(markTargetSchema.safeParse([]).success).toBe(false);
    expect(markTargetSchema.safeParse([""]).success).toBe(false);
    expect(markTargetSchema.safeParse(Array.from({ length: 201 }, () => "x")).success).toBe(false);
    expect(markTargetSchema.safeParse("some").success).toBe(false);
  });

  it("is read from the page's forms: the all flag, or one id per field", () => {
    const all = new FormData();
    all.set("all", "1");
    expect(markTargetFromForm(all)).toBe("all");

    const one = new FormData();
    one.append("id", "11111111-1111-4111-8111-111111111111");
    expect(markTargetFromForm(one)).toEqual(["11111111-1111-4111-8111-111111111111"]);

    expect(markTargetFromForm(new FormData())).toBeNull();
  });
});
