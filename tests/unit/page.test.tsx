import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import Home from "@/app/page";
import { MAX_GROWTH_STAGE } from "@/domain/companion";

describe("landing page", () => {
  it("leads with the invitation, in German", () => {
    render(<Home />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Sprich einfach los.");
    expect(heading).toHaveAttribute("lang", "de");
  });

  it("puts the English right underneath, never behind an interaction", () => {
    render(<Home />);

    expect(screen.getByText("Just start talking.")).toBeInTheDocument();
  });

  it("marks every German passage so a screen reader switches voice", () => {
    const { container } = render(<Home />);

    const german = container.querySelectorAll('[lang="de"]');
    expect(german.length).toBeGreaterThanOrEqual(3);
  });

  it("sends both calls to action to sign-up", () => {
    render(<Home />);

    const starts = screen.getAllByRole("link", { name: /start free/i });
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (const link of starts) {
      expect(link).toHaveAttribute("href", "/auth/sign-up");
    }
  });

  it("offers a way back for someone who already has an account", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/auth/login",
    );
  });

  it("shows a real correction rather than a claim about corrections", () => {
    render(<Home />);

    expect(screen.getByText(/gestern nach Berlin gefahren/)).toBeInTheDocument();
    expect(screen.getByText(/third time this month/i)).toBeInTheDocument();
  });

  it("shows every growth stage in the progress strip", () => {
    render(<Home />);

    const strip = screen.getByRole("list");
    expect(within(strip).getAllByRole("listitem")).toHaveLength(
      MAX_GROWTH_STAGE,
    );
  });

  it("keeps the decorative companions out of the accessibility tree", () => {
    // Five identical blobs announced one after another is noise, and the
    // level range beside each one already carries the meaning.
    render(<Home />);

    const strip = screen.getByRole("list");
    expect(within(strip).queryAllByRole("img")).toHaveLength(0);
  });

  it("states the certification limit rather than burying it", () => {
    render(<Home />);

    expect(screen.getByText(/do not issue certificates/i)).toBeInTheDocument();
  });

  it("has one first-level heading and a section heading for each claim", () => {
    render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(3);
  });
});
