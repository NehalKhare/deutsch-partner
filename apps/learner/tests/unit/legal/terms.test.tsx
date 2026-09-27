import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import TermsPage, { metadata } from "@/app/legal/terms/page";
import { TERMS_VERSION } from "@dp/domain/billing";

/**
 * The terms an order refers to. Not written yet (spec S11, B10), and the
 * page must say so in the open rather than look like terms nobody drafted.
 */

describe("/legal/terms", () => {
  it("says, first, that the terms are being finalised", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/terms and withdrawal/i);
    expect(screen.getByRole("note")).toHaveTextContent(/being finalised/i);
  });

  it("names the version the order page records", () => {
    render(<TermsPage />);

    expect(screen.getByText(new RegExp(TERMS_VERSION))).toBeInTheDocument();
  });

  it("restates what an order already commits to, including the withdrawal right", () => {
    render(<TermsPage />);

    expect(screen.getByText(/withdraw within 14 days/i)).toBeInTheDocument();
    expect(screen.getByText(/include VAT/i)).toBeInTheDocument();
  });

  it("is kept out of search results until it is real", () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
