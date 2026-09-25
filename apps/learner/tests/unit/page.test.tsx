import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import Home from "@/app/page";
import { MAX_GROWTH_STAGE } from "@dp/domain/companion";
import { FAQ } from "@/lib/landing/faq";

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

    const strip = screen.getByRole("list", { name: /growth stages/i });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(
      MAX_GROWTH_STAGE,
    );
  });

  it("keeps the decorative companions out of the accessibility tree", () => {
    // Five identical blobs announced one after another is noise, and the
    // level range beside each one already carries the meaning.
    render(<Home />);

    const strip = screen.getByRole("list", { name: /growth stages/i });
    expect(within(strip).queryAllByRole("img")).toHaveLength(0);
  });

  it("states the certification limit rather than burying it", () => {
    render(<Home />);

    expect(screen.getByText(/do not issue certificates/i)).toBeInTheDocument();
  });

  it("names what you can do, feature by feature, without a superlative", () => {
    render(<Home />);

    const grid = screen.getByRole("list", { name: /what you can do/i });
    for (const room of ["Talk", "Train", "Play a scene", "Speak and listen"]) {
      expect(within(grid).getByRole("heading", { name: room })).toBeInTheDocument();
    }
    // The register check: this page describes, it does not shout.
    expect(grid.textContent).not.toMatch(/best|revolutionary|amazing|effortless/i);
  });

  it("gives the timeline at both paces, computed from the same hours", () => {
    render(<Home />);

    // The A1 row: about 6 months at half an hour, about 3 at a full one.
    const row = screen.getByRole("row", { name: /A1/ });
    expect(within(row).getByText("about 6 months")).toBeInTheDocument();
    expect(within(row).getByText("about 3 months")).toBeInTheDocument();
  });

  it("says what the timeline is based on, and that pace differs", () => {
    render(<Home />);

    expect(screen.getByText(/guided hours language schools plan/i)).toBeInTheDocument();
    expect(screen.getByText(/your pace will differ/i)).toBeInTheDocument();
  });

  it("explains why it is not tiring as a mechanism, not a mood", () => {
    render(<Home />);

    expect(screen.getByText(/mostly language you\s+already handle/i)).toBeInTheDocument();
    expect(screen.getByText(/the next mini-level\s+comes to you/i)).toBeInTheDocument();
  });

  it("answers the questions a visitor asks, in the open and not behind a click", () => {
    render(<Home />);

    const section = screen.getByRole("region", { name: /questions, answered plainly/i });
    for (const entry of FAQ) {
      expect(within(section).getByRole("heading", { level: 3, name: entry.question })).toBeInTheDocument();
      expect(within(section).getByText(entry.answer)).toBeInTheDocument();
    }
  });

  it("carries structured data that says what the page says", () => {
    // What a search engine shows and what an answer engine quotes. The FAQ
    // in it must be the FAQ on the page: markup that claims more than the
    // page shows is markup that gets a site penalised.
    const { container } = render(<Home />);

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const graph = JSON.parse(script!.textContent ?? "")["@graph"] as Array<Record<string, unknown>>;
    const faq = graph.find((node) => node["@type"] === "FAQPage")!;
    const questions = (faq.mainEntity as Array<{ name: string }>).map((entry) => entry.name);
    expect(questions).toEqual(FAQ.map((entry) => entry.question));
    for (const question of questions) {
      expect(screen.getByRole("heading", { level: 3, name: question })).toBeInTheDocument();
    }
  });

  it("has one first-level heading and a section heading for each claim", () => {
    render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(3);
  });
});
