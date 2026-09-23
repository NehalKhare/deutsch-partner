import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeToggle } from "../src/theme-toggle";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "../src/theme";

/**
 * The switch itself.
 *
 * What is checked is the contract the rest of the page depends on: the three
 * options are a real radio group, choosing one writes both the attribute the
 * CSS reads and the key the head script reads, and choosing System clears the
 * override rather than freezing today's answer to it.
 */

afterEach(() => {
  // Storage itself is cleared by the shared jsdom setup.
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("the theme toggle", () => {
  it("offers the three choices as one named radio group", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    for (const name of ["System", "Light", "Dark"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
  });

  it("starts on System when nothing has been chosen", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("shows the stored override rather than the default", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeToggle />);

    expect(await screen.findByRole("radio", { name: "Light" })).toBeChecked();
  });

  it("writes the attribute the stylesheet reads when a theme is chosen", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("clears the override when System is chosen again", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await user.click(screen.getByRole("radio", { name: "System" }));

    // The *attribute* is what hands the page back to the OS, and its absence
    // is the instruction. The stored "system" is harmless: the head script
    // acts on "light" and "dark" and on nothing else.
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("keeps two instances on the same page in step", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );

    const [firstDark] = screen.getAllByRole("radio", { name: "Dark" });
    await user.click(firstDark!);

    // The `storage` event does not fire in the tab that wrote the value, so
    // without a signal of its own the second switch would still say System.
    for (const radio of screen.getAllByRole("radio", { name: "Dark" })) {
      expect(radio).toBeChecked();
    }
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("follows a change made in another tab", async () => {
    render(<ThemeToggle />);

    // What the browser delivers to every *other* tab when one of them writes.
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    window.dispatchEvent(
      new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }),
    );

    expect(await screen.findByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
  });

  it("names the group for a screen reader even when the caption is hidden", () => {
    render(<ThemeToggle hideLegend />);

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });
});
