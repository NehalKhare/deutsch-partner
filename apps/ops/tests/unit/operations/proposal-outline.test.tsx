import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  ProposalOutline,
  type OutlineItem,
} from "@/components/operations/proposal-outline";

/**
 * The rail that gets an operator back to the decision.
 *
 * The proposal page puts the evidence above the decision on purpose. What is
 * checked here is the way back: that the rail is a navigation landmark, that
 * every entry points at a heading that exists on the page, and that the one
 * entry drawn in the accent is the operator's own move — because the accent
 * is this palette's light source and spending it on anything else is what
 * makes it stop meaning anything.
 */

const ITEMS: readonly OutlineItem[] = [
  { id: "proposal-heading", label: "The proposal" },
  { id: "evidence-heading", label: "Evidence", count: 3 },
  { id: "timeline-heading", label: "Timeline", count: 0 },
  { id: "actions-heading", label: "Your decision", accent: true },
];

describe("the outline", () => {
  it("is a navigation landmark with a name", () => {
    render(<ProposalOutline items={ITEMS} />);

    expect(
      screen.getByRole("navigation", { name: /on this page/i }),
    ).toBeInTheDocument();
  });

  it("points every entry at the heading it names", () => {
    render(<ProposalOutline items={ITEMS} />);

    expect(screen.getByRole("link", { name: /the proposal/i })).toHaveAttribute(
      "href",
      "#proposal-heading",
    );
    expect(screen.getByRole("link", { name: /your decision/i })).toHaveAttribute(
      "href",
      "#actions-heading",
    );
  });

  it("keeps the page's own order, so the rail reads like the page", () => {
    render(<ProposalOutline items={ITEMS} />);

    const labels = screen
      .getAllByRole("link")
      .map((link) => link.textContent?.replace(/\d+$/, "").trim());

    expect(labels).toEqual([
      "The proposal",
      "Evidence",
      "Timeline",
      "Your decision",
    ]);
  });

  it("counts what is in a section, so the rail says where the bulk is", () => {
    render(<ProposalOutline items={ITEMS} />);

    const evidence = screen.getByRole("link", { name: /evidence/i });
    expect(within(evidence).getByText("3")).toBeInTheDocument();
  });

  it("spends the accent only on the operator's own move", () => {
    render(<ProposalOutline items={ITEMS} />);

    expect(screen.getByRole("link", { name: /your decision/i }).className).toContain(
      "text-brand",
    );
    expect(screen.getByRole("link", { name: /timeline/i }).className).not.toContain(
      "text-brand",
    );
  });

  it("drops the accent when nothing is waiting on the operator", () => {
    render(
      <ProposalOutline
        items={[{ id: "actions-heading", label: "Your decision" }]}
      />,
    );

    expect(screen.getByRole("link", { name: /your decision/i }).className).not.toContain(
      "text-brand",
    );
  });
});
