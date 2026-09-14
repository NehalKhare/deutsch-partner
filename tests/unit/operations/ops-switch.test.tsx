import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  OpsSwitch,
  PROPOSALS_PATH,
  RUNS_PATH,
} from "@/components/operations/ops-switch";

/**
 * The one way across, between the two halves of product ops.
 *
 * Worth a test of its own because the split only works if the way back is
 * obvious from either side: a proposal board with no route to the scans is a
 * page an operator leaves through the address bar. What is checked is that
 * each direction is a link with a name that says where it goes, that the name
 * is the same word wherever it is drawn, and that the arrow — decoration —
 * stays out of the accessible name.
 */

describe("the switch between the two operator pages", () => {
  it("offers the scans and runs to a page showing proposals", () => {
    render(<OpsSwitch to="runs" />);

    expect(
      screen.getByRole("link", { name: "Market scans & runs" }),
    ).toHaveAttribute("href", RUNS_PATH);
  });

  it("offers the proposals to a page showing runs", () => {
    render(<OpsSwitch to="proposals" />);

    expect(screen.getByRole("link", { name: "Proposals" })).toHaveAttribute(
      "href",
      PROPOSALS_PATH,
    );
  });

  it("names a destination the same way however loudly it is drawn", () => {
    const { unmount } = render(<OpsSwitch to="runs" />);
    const loud = screen.getByRole("link").textContent;
    unmount();

    render(<OpsSwitch to="runs" tone="quiet" />);

    expect(screen.getByRole("link").textContent).toBe(loud);
  });
});
