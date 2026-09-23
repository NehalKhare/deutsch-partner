import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OpsAccountMenu } from "@/components/ops-account-menu";

/**
 * The account menu at the right of the header.
 *
 * Two things it must get right. Ending a session is behind a deliberate
 * second action rather than one stray click in the chrome — that was the point
 * of moving it off the bar — and the address is readable in full inside,
 * because the button can only afford a fragment and a fragment is exactly what
 * is ambiguous between two logins.
 */

const noop = async () => {};

function renderMenu(over: Partial<Parameters<typeof OpsAccountMenu>[0]> = {}) {
  return render(
    <OpsAccountMenu
      label="nehal.khare"
      email="nehal.khare@example.com"
      signOut={noop}
      {...over}
    />,
  );
}

const open = async () =>
  userEvent.click(screen.getByRole("button", { name: /nehal\.khare/i }));

describe("closed", () => {
  it("says who is signed in", () => {
    renderMenu();

    expect(screen.getByRole("button", { name: /nehal\.khare/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps sign out out of reach of one stray click", () => {
    renderMenu();

    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });
});

describe("open", () => {
  it("shows the address in full", async () => {
    renderMenu();
    await open();

    expect(screen.getByText("nehal.khare@example.com")).toBeInTheDocument();
  });

  it("carries the theme switch and the way out", async () => {
    renderMenu();
    await open();

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to the button", async () => {
    renderMenu();
    await open();

    await userEvent.keyboard("{Escape}");

    const trigger = screen.getByRole("button", { name: /nehal\.khare/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes when a pointer lands outside it", async () => {
    renderMenu();
    await open();

    await userEvent.click(document.body);

    expect(screen.getByRole("button", { name: /nehal\.khare/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("an account with no address", () => {
  it("still draws a menu rather than an empty button", async () => {
    renderMenu({ label: "Signed in", email: null });
    await userEvent.click(screen.getByRole("button", { name: "Signed in" }));

    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
