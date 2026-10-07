import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { CompactLegalFooter, LEGAL_LINKS, PublicFooter } from "@/components/site/public-footer";
import { PublicHeader } from "@/components/site/public-header";
import { QuietPage } from "@/components/site/quiet-page";

/**
 * The header and footer of the public pages, and the legal links every
 * shell must carry.
 *
 * Pricing is in beta, and every link to it says so with a pill beside it —
 * beside rather than inside, so the link's name is still just "Pricing".
 * The legal links are the Impressum and the privacy policy (owed on every
 * page), the terms, the withdrawal instructions and the §312k BGB button,
 * which must read "Cancel contracts here" and nothing cleverer.
 */

const EXPECTED_LEGAL = [
  ["Impressum", "/legal/impressum"],
  ["Privacy", "/legal/privacy"],
  ["Terms", "/legal/terms"],
  ["Withdrawal", "/legal/withdrawal"],
  ["Cancel contracts here", "/legal/cancel"],
] as const;

function expectLegalLinks(container: HTMLElement) {
  const nav = within(container).getByRole("navigation", { name: "Legal" });
  for (const [label, href] of EXPECTED_LEGAL) {
    expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", href);
  }
}

describe("the legal links", () => {
  it("are exactly the five the law puts in a footer, in this order", () => {
    expect(LEGAL_LINKS.map((link) => [link.label, link.href])).toEqual(EXPECTED_LEGAL.map((pair) => [...pair]));
  });
});

describe("the footer", () => {
  it("marks Pricing as a beta beside the link", () => {
    render(<PublicFooter />);

    const link = screen.getByRole("link", { name: "Pricing" });
    const pill = screen.getByText("Beta");

    expect(link).toHaveAttribute("href", "/pricing");
    expect(link.nextElementSibling).toBe(pill);
  });

  it("carries every legal link", () => {
    const { container } = render(<PublicFooter />);

    expectLegalLinks(container);
  });
});

describe("the compact footer, for the shells with no room for one", () => {
  it("carries every legal link too", () => {
    const { container } = render(<CompactLegalFooter />);

    expectLegalLinks(container);
  });
});

describe("the quiet page", () => {
  it("puts the legal links under a sign-in card", () => {
    const { container } = render(
      <QuietPage>
        <p>card</p>
      </QuietPage>,
    );

    expectLegalLinks(container);
  });
});

describe("the header's shortcut", () => {
  it("carries the beta pill when the page it points at is in beta", () => {
    render(<PublicHeader shortcut={{ href: "/pricing", label: "Pricing", beta: true }} />);

    expect(screen.getByRole("link", { name: "Pricing" }).nextElementSibling).toBe(screen.getByText("Beta"));
  });

  it("carries none otherwise", () => {
    render(<PublicHeader shortcut={{ href: "#plans", label: "Plans" }} />);

    expect(screen.getByRole("link", { name: "Plans" })).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });
});
