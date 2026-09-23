import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SectionPanel } from "@/components/operations/section-panel";

/**
 * A foldable section of the proposal page.
 *
 * What matters here is what folding must not cost. The heading keeps its id,
 * because every `aria-labelledby` and every outline link lands on it and a
 * folded section is still a place to jump to. And the fold is the browser's,
 * not React's: the page refreshes itself every few seconds while a run is
 * working, and a section the operator opened has to survive that.
 */

function panel(props: Partial<Parameters<typeof SectionPanel>[0]> = {}) {
  return render(
    <SectionPanel id="evidence-heading" title="Evidence" {...props}>
      <p>Cited somewhere.</p>
    </SectionPanel>,
  );
}

describe("a foldable section", () => {
  it("keeps the heading addressable, so the outline can point at it", () => {
    panel();

    expect(screen.getByRole("heading", { name: "Evidence" })).toHaveAttribute(
      "id",
      "evidence-heading",
    );
  });

  it("labels its section with that heading", () => {
    const { container } = panel();

    expect(container.querySelector("section")).toHaveAttribute(
      "aria-labelledby",
      "evidence-heading",
    );
  });

  it("starts folded, because most of this page is reference", () => {
    const { container } = panel();

    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("starts open when the section is one you read before deciding", () => {
    const { container } = panel({ defaultOpen: true });

    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("says how much is inside, so a fold is not a hiding place", () => {
    panel({ count: 4 });

    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows no count where counting says nothing", () => {
    const { container } = panel();

    expect(container.querySelector("summary")?.textContent).toBe("Evidence");
  });

  it("gives the whole row to the press, not just a chevron", () => {
    const { container } = panel();

    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(summary?.querySelector("h2")).not.toBeNull();
  });

  it("keeps a section the operator opened open when the page refreshes itself", () => {
    // The run activity panel calls router.refresh() every few seconds while a
    // run is working. React must not write `open` back over the browser's.
    const { container, rerender } = panel();

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    details!.open = true;

    rerender(
      <SectionPanel id="evidence-heading" title="Evidence">
        <p>Cited somewhere.</p>
      </SectionPanel>,
    );

    expect(container.querySelector("details")?.open).toBe(true);
  });
});
