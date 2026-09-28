import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { OpsShell } from "@/components/ops-shell";

/**
 * The operator shell's header.
 *
 * The operator product is still in beta, and the header says so beside the
 * name at every size, not only where there is room for the "Operations" label.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/costs" }));

const noop = async () => {};

describe("the header", () => {
  it("marks the operator product as a beta beside its name", () => {
    render(
      <OpsShell email="nehal.khare@example.com" signOut={noop}>
        <p>page</p>
      </OpsShell>,
    );

    const header = screen.getByRole("banner");
    const pill = screen.getByText("Beta");

    expect(header).toContainElement(pill);
    expect(pill.parentElement).toContainElement(screen.getByRole("link", { name: "Deutsch Partner" }));
    expect(pill.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });
});
