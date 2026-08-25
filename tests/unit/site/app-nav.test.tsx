import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AppNav } from "@/components/site/app-nav";

/**
 * The signed-in navigation.
 *
 * Worth testing for one thing only: that the current room says so, to eyes
 * via the style hook and to a screen reader via aria-current — and that a
 * thread under /chat still counts as being in Chat.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/dashboard" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

describe("the signed-in navigation", () => {
  it("offers every room a learner has", () => {
    pathname.current = "/dashboard";
    render(<AppNav />);

    for (const label of [
      "Dashboard",
      "Chat",
      "Scenarios",
      "Curriculum",
      "Review",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("holds only rooms, not the account", () => {
    // Settings and the way out are about who is signed in rather than about
    // German. They live in the account menu on the right.
    pathname.current = "/dashboard";
    render(<AppNav />);

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("does not offer the Trainer, which is reached from Review", () => {
    // It is not a place to go: it is what you do about what Review found, and
    // it is opened from the screen that knows there is something to do.
    pathname.current = "/dashboard";
    render(<AppNav />);

    expect(screen.queryByRole("link", { name: "Trainer" })).not.toBeInTheDocument();
  });

  it("marks the current page for a screen reader", () => {
    pathname.current = "/review";
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("counts a thread as being in Chat", () => {
    pathname.current = "/chat/1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not offer the operator room", () => {
    // The spend dashboard is in the account menu, and only for operators. A
    // nav entry would tell every learner there is a door worth finding.
    pathname.current = "/dashboard";
    render(<AppNav />);

    expect(screen.queryByRole("link", { name: /spend|cost|operations/i })).not.toBeInTheDocument();
  });
});
