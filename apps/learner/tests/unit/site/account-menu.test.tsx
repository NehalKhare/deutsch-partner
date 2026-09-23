import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountMenu } from "@/components/site/account-menu";

/**
 * The account menu.
 *
 * Two things it must get right. Ending a session is behind a deliberate
 * second action rather than one stray click in the header — and the operator's
 * spend dashboard is not merely hidden from non-operators but absent from what
 * they are sent, because a link in the markup is a link somebody finds.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/dashboard" } }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

const noop = async () => {};

function renderMenu(over: Partial<Parameters<typeof AccountMenu>[0]> = {}) {
  return render(
    <AccountMenu
      label="nehal.khare"
      email="nehal.khare@example.com"
      signOut={noop}
      {...over}
    />,
  );
}

const openMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: /nehal\.khare/i }));
};

describe("closed", () => {
  it("shows who is signed in", () => {
    renderMenu();

    expect(screen.getByRole("button", { name: /nehal\.khare/i })).toBeInTheDocument();
  });

  it("is still named for the account when a phone shows only the avatar", () => {
    // The name is visually hidden below `sm`, not removed: the initial alone
    // is not an accessible name.
    renderMenu();

    expect(screen.getByRole("button", { name: /nehal\.khare/i })).toHaveAccessibleName(
      "nehal.khare",
    );
  });

  it("says it opens something, and that it is shut", () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: /nehal\.khare/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "true");
  });

  it("keeps sign-out out of reach of a stray click", () => {
    // The whole reason it moved off the header: one mis-click used to end the
    // session outright.
    renderMenu();

    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});

describe("opened", () => {
  it("offers settings and the way out", async () => {
    renderMenu();
    await openMenu();

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("shows the whole address, which the button could only abbreviate", async () => {
    // Which account, not merely that there is one. The fragment on the button
    // is exactly what is ambiguous between two logins.
    renderMenu();
    await openMenu();

    expect(screen.getByText("nehal.khare@example.com")).toBeInTheDocument();
  });

  it("renders without an address at all", async () => {
    renderMenu({ label: "Account", email: null });

    await userEvent.click(screen.getByRole("button", { name: /account/i }));

    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks settings as the current page when it is", async () => {
    pathname.current = "/settings";
    renderMenu();
    await openMenu();

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    pathname.current = "/dashboard";
  });
});

describe("closing it", () => {
  it("closes on a second press", async () => {
    renderMenu();
    await openMenu();
    await openMenu();

    expect(screen.getByRole("button", { name: /nehal\.khare/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("closes on Escape, and gives the keyboard back to the button", async () => {
    // Escape that drops focus to the document strands a keyboard at the top
    // of the page with no word about what happened.
    renderMenu();
    await openMenu();

    await userEvent.keyboard("{Escape}");

    const trigger = screen.getByRole("button", { name: /nehal\.khare/i });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).toHaveFocus();
  });

  it("closes when something else on the page is clicked", async () => {
    render(<div data-testid="elsewhere">elsewhere</div>);
    renderMenu();
    await openMenu();

    await userEvent.click(screen.getByTestId("elsewhere"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /nehal\.khare/i })).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
  });

  it("stays open when something inside it is clicked", async () => {
    renderMenu();
    await openMenu();

    await userEvent.click(screen.getByText("nehal.khare@example.com"));

    expect(screen.getByRole("button", { name: /nehal\.khare/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("signing out", () => {
  it("submits the form the button belongs to", async () => {
    // A form and a server action, not a fetch: it works before hydration, and
    // the session ends on the server rather than in this tab.
    renderMenu();
    await openMenu();

    const signOut = screen.getByRole("button", { name: /sign out/i });
    expect(signOut).toHaveAttribute("type", "submit");
    expect(signOut.closest("form")).not.toBeNull();
  });
});

describe("the panel itself", () => {
  it("is named by the button that opens it", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: /nehal\.khare/i });
    await openMenu();

    const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-labelledby", trigger.id);
    expect(within(panel!).getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });
});
