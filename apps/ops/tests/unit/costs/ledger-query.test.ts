import { describe, expect, it } from "vitest";

import { ledgerHref, ledgerQueryFromParams, ledgerFilterFor } from "@/lib/ledger-query";

const HASH = "0123456789abcdef0123456789abcdef";
const REQUEST = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NOW = new Date("2026-09-23T15:00:00Z");

describe("reading the ledger's search params", () => {
  it("defaults to the last day, unfiltered", () => {
    expect(ledgerQueryFromParams({})).toEqual({ days: 1 });
  });

  it("keeps every filter it recognises", () => {
    expect(
      ledgerQueryFromParams({
        days: "7",
        status: "budget_denied",
        task: "conversation.turn",
        tier: "strong",
        model: "vendor/resolved",
        user: HASH,
        request: REQUEST,
        truncated: "1",
        degraded: "1",
        escalated: "1",
        stale: "1",
        before: "912",
      }),
    ).toEqual({
      days: 7,
      status: "budget_denied",
      task: "conversation.turn",
      tier: "strong",
      model: "vendor/resolved",
      user: HASH,
      request: REQUEST,
      truncated: true,
      degraded: true,
      escalated: true,
      stale: true,
      before: 912,
    });
  });

  it("drops what it cannot use rather than failing the page", () => {
    // A hand-edited URL is not an error worth a blank page; it is a filter
    // that does not apply.
    expect(
      ledgerQueryFromParams({
        days: "400",
        status: "exploded",
        tier: "gigantic",
        user: "alice@example.com",
        request: "not-a-uuid",
        truncated: "yes please",
        before: "-4",
      }),
    ).toEqual({ days: 1 });
  });

  it("treats a blank field from the filter form as absent", () => {
    expect(ledgerQueryFromParams({ task: "", model: "  ", status: "" })).toEqual({ days: 1 });
  });

  it("takes the first of a repeated param", () => {
    expect(ledgerQueryFromParams({ status: ["error", "ok"] })).toEqual({ days: 1, status: "error" });
  });
});

describe("the filter a query asks the repository for", () => {
  it("is a window ending now", () => {
    const filter = ledgerFilterFor({ days: 7, status: "error", stale: true }, NOW);

    expect(filter).toEqual({
      from: new Date("2026-09-16T15:00:00Z"),
      to: NOW,
      status: "error",
      fxStale: true,
    });
  });
});

describe("a link back into the ledger", () => {
  it("spells only what is set, so links stay short and shareable", () => {
    expect(ledgerHref({ days: 1 })).toBe("/costs/invocations");
    expect(ledgerHref({ days: 7, user: HASH })).toBe(`/costs/invocations?days=7&user=${HASH}`);
  });

  it("round-trips through the parser", () => {
    const query = { days: 3, status: "timeout" as const, truncated: true as const, before: 40 };
    const href = ledgerHref(query);
    const params = Object.fromEntries(new URL(href, "https://ops.test").searchParams);

    expect(ledgerQueryFromParams(params)).toEqual(query);
  });
});
