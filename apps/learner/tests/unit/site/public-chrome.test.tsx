import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PublicFooter } from "@/components/site/public-footer";
import { PublicHeader } from "@/components/site/public-header";

/**
 * The header and footer of the public pages.
 *
 * Pricing is in beta, and every link to it says so with a pill beside it —
 * beside rather than inside, so the link's name is still just "Pricing".
 */

describe("the footer", () => {
  it("marks Pricing as a beta beside the link", () => {
    render(<PublicFooter />);

    const link = screen.getByRole("link", { name: "Pricing" });
    const pill = screen.getByText("Beta");

    expect(link).toHaveAttribute("href", "/pricing");
    expect(link.nextElementSibling).toBe(pill);
  });

  it("leaves the terms unmarked", () => {
    render(<PublicFooter />);

    expect(screen.getByRole("link", { name: "Terms" }).nextElementSibling).toBeNull();
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
