import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AppNav } from "@/components/site/app-nav";

/**
 * The signed-in navigation.
 *
 * Three things worth pinning. The order and the grouping, because they are
 * the whole point of the bar: two rooms you look at, two where somebody
 * answers, and the one where the work is. That the current room says so, to
 * eyes via the style hook and to a screen reader via aria-current. And that
 * Catch up only wears the error colour when something is genuinely overdue.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/dashboard" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

const renderNav = (dueCount = 0) => render(<AppNav dueCount={dueCount} />);

/** The Catch up link, whichever accessible name the due count gave it. */
const catchUp = () => screen.getByRole("link", { name: /catch up/i });

describe("the rooms and their order", () => {
  it("offers every room a learner has, in the order the bar means", () => {
    // The order is the request: look at the path, then talk, then fix.
    pathname.current = "/dashboard";
    renderNav();

    const labels = screen
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());

    expect(labels).toEqual([
      "Dashboard",
      "Curriculum",
      "Chat",
      "Scenarios",
      "Catch up",
    ]);
  });

  it("puts the two rooms where somebody answers in one labelled group", () => {
    pathname.current = "/dashboard";
    renderNav();

    const talk = screen.getByRole("group", { name: /talk with your tutor/i });

    expect(within(talk).getByRole("link", { name: "Chat" })).toBeInTheDocument();
    expect(within(talk).getByRole("link", { name: "Scenarios" })).toBeInTheDocument();
    // And nothing else: a capsule that crept to three items is not a pair.
    expect(within(talk).getAllByRole("link")).toHaveLength(2);
    expect(
      within(talk).queryByRole("link", { name: "Dashboard" }),
    ).not.toBeInTheDocument();
  });

  it("holds only rooms, not the account", () => {
    // Settings and the way out are about who is signed in rather than about
    // German. They live in the account menu on the right.
    pathname.current = "/dashboard";
    renderNav();

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("does not offer the Trainer, which is reached from Catch up", () => {
    // It is not a place to go: it is what you do about what Catch up found,
    // and it is opened from the screen that knows there is something to do.
    pathname.current = "/dashboard";
    renderNav();

    expect(screen.queryByRole("link", { name: "Trainer" })).not.toBeInTheDocument();
  });

  it("does not offer the operator room", () => {
    // The spend dashboard is in the account menu, and only for operators. A
    // nav entry would tell every learner there is a door worth finding.
    pathname.current = "/dashboard";
    renderNav();

    expect(
      screen.queryByRole("link", { name: /spend|cost|operations/i }),
    ).not.toBeInTheDocument();
  });
});

describe("where you are", () => {
  it("marks the current page for a screen reader", () => {
    // Still /review: only the name a learner reads changed, so a bookmark
    // and every existing link still land somewhere that highlights.
    pathname.current = "/review";
    renderNav();

    expect(catchUp()).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("counts a thread as being in Chat", () => {
    pathname.current = "/chat/1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
    renderNav();

    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("highlights inside the capsule, not just outside it", () => {
    pathname.current = "/scenarios";
    renderNav();

    expect(screen.getByRole("link", { name: "Scenarios" })).toHaveClass(
      "text-brand",
    );
  });
});

describe("the overdue count", () => {
  it("stays quiet when nothing is waiting", () => {
    // Bold always — it is where the work is — but ember is the product's
    // error colour, and a nav item permanently wearing it is a fault light
    // nobody looks at.
    pathname.current = "/dashboard";
    const { container } = renderNav(0);

    expect(catchUp()).toHaveClass("font-semibold");
    expect(catchUp()).not.toHaveClass("text-ember");
    expect(container.querySelector("[data-role='due-count']")).toBeNull();
  });

  it("colours itself and shows the count when words are overdue", () => {
    pathname.current = "/dashboard";
    const { container } = renderNav(12);

    expect(catchUp()).toHaveClass("text-ember");
    expect(container.querySelector("[data-role='due-count']")).toHaveTextContent(
      "12",
    );
  });

  it("says what the number means, rather than reading it out bare", () => {
    // "Catch up 12" announced on its own says nothing.
    pathname.current = "/dashboard";
    const { container } = renderNav(3);

    expect(catchUp()).toHaveAccessibleName("Catch up, 3 due");
    expect(container.querySelector("[data-role='due-count']")).toHaveAttribute(
      "aria-hidden",
    );
  });

  it("keeps the accessible name plain when there is nothing due", () => {
    pathname.current = "/dashboard";
    renderNav(0);

    expect(catchUp()).toHaveAccessibleName("Catch up");
  });

  it("treats a missing count as nothing waiting", () => {
    // The shell passes 0 when the read fails: an unreadable database must not
    // invent urgency.
    pathname.current = "/dashboard";
    render(<AppNav />);

    expect(catchUp()).not.toHaveClass("text-ember");
  });

  it("caps the badge at 99+ but still says the real number", () => {
    // A tab-bar column has room for three characters; the accessible name
    // has room for the truth.
    pathname.current = "/dashboard";
    const { container } = renderNav(240);

    expect(container.querySelector("[data-role='due-count']")).toHaveTextContent("99+");
    expect(catchUp()).toHaveAccessibleName("Catch up, 240 due");
  });
});
