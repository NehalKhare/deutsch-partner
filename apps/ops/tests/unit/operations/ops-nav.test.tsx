import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { activeRoom, OpsNav, OPS_ROOMS } from "@/components/ops-nav";

/**
 * The rail.
 *
 * The rule worth a test is which room lights up. `/product/runs` sits under
 * `/product`, so the obvious prefix test lights two at once; and a proposal at
 * `/product/<id>` has no room of its own and has to light the board it came
 * from rather than nothing at all. Both were wrong in the top bar this
 * replaced, where nothing was ever marked as current.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/product" } }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

function renderNav(at: string) {
  pathname.current = at;
  return render(<OpsNav />);
}

describe("the rooms it offers", () => {
  it("names all four, each pointing at its own page", () => {
    renderNav("/product");

    const expected = [
      ["Feature proposals", "/product"],
      ["Market Scan", "/product/runs"],
      ["Trainer feedback", "/feedback"],
      ["AI spend", "/costs"],
    ] as const;

    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("is one named navigation landmark, not a loose row of links", () => {
    renderNav("/product");

    expect(screen.getByRole("navigation", { name: "Operations" })).toBeInTheDocument();
  });
});

describe("which room is the current one", () => {
  it("marks the page you are on", () => {
    renderNav("/costs");

    expect(screen.getByRole("link", { name: "AI spend" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks only one room on a nested page", () => {
    renderNav("/product/runs");

    // The board is a prefix of this path and must not light up with it.
    expect(screen.getByRole("link", { name: "Market Scan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Feature proposals" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps a proposal under the board it was opened from", () => {
    renderNav("/product/7f3c9a2e-0000-4000-8000-000000000000");

    expect(screen.getByRole("link", { name: "Feature proposals" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("the matching rule on its own", () => {
  it("prefers the longest room that matches", () => {
    expect(activeRoom("/product")).toBe("/product");
    expect(activeRoom("/product/runs")).toBe("/product/runs");
    expect(activeRoom("/product/abc")).toBe("/product");
    expect(activeRoom("/feedback")).toBe("/feedback");
  });

  it("matches nothing off the rail", () => {
    expect(activeRoom("/login")).toBeNull();
  });

  it("covers every room the rail draws", () => {
    for (const room of OPS_ROOMS) expect(activeRoom(room.href)).toBe(room.href);
  });
});
