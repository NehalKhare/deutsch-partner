import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import ImpressumPage, { metadata as impressumMetadata } from "@/app/legal/impressum/page";
import PrivacyPage, { metadata as privacyMetadata, PROCESSORS } from "@/app/legal/privacy/page";
import TermsPage, { metadata as termsMetadata } from "@/app/legal/terms/page";
import WithdrawalPage, { metadata as withdrawalMetadata } from "@/app/legal/withdrawal/page";
import { TERMS_VERSION } from "@dp/domain/billing";
import { LEGAL_ENTITY } from "@/lib/legal/entity";
import { STORAGE_ITEMS } from "@/lib/legal/storage";

/**
 * The four legal pages (billing-and-plans-spec.md S11, B10).
 *
 * What a page must say is checked here; whether it says it well is a
 * lawyer's question. Each is public and indexed: a consumer searching for
 * who runs this site should find the answer.
 */

describe("/legal/impressum", () => {
  it("names the provider, the address, an email and a phone number (§5 DDG)", () => {
    render(<ImpressumPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Impressum");
    expect(screen.getByText(new RegExp(LEGAL_ENTITY.name.replace(/[[\]]/g, "\\$&")))).toBeInTheDocument();
    expect(screen.getByText(LEGAL_ENTITY.email)).toBeInTheDocument();
    expect(screen.getByText(LEGAL_ENTITY.phone)).toBeInTheDocument();
  });

  it("names who is responsible for the content (§18(2) MStV)", () => {
    render(<ImpressumPage />);

    expect(screen.getByRole("heading", { name: /responsible for content/i })).toBeInTheDocument();
  });

  it("links the EU dispute-resolution platform and states the VSBG position", () => {
    render(<ImpressumPage />);

    expect(screen.getByRole("link", { name: /ec\.europa\.eu\/consumers\/odr/ })).toHaveAttribute(
      "href",
      "https://ec.europa.eu/consumers/odr",
    );
    expect(screen.getByText(/consumer arbitration board/i)).toBeInTheDocument();
  });

  it("says the tutor is an AI (AI Act Art. 50)", () => {
    render(<ImpressumPage />);

    expect(screen.getByText(/is an artificial intelligence/i)).toBeInTheDocument();
  });

  it("is public, canonical and indexable", () => {
    expect(impressumMetadata.alternates).toEqual({ canonical: "/legal/impressum" });
    expect(impressumMetadata.robots).toBeUndefined();
  });
});

describe("/legal/privacy", () => {
  it("names the controller and the supervisory authority", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/privacy policy/i);
    expect(screen.getByText(/the controller under the gdpr/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: LEGAL_ENTITY.supervisoryAuthority.name })).toHaveAttribute(
      "href",
      LEGAL_ENTITY.supervisoryAuthority.url,
    );
  });

  it("lists every processor the code calls, and says data crosses to third countries", () => {
    render(<PrivacyPage />);

    for (const processor of PROCESSORS) {
      expect(screen.getByText(processor.name)).toBeInTheDocument();
    }
    expect(PROCESSORS.map((p) => p.name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/OpenRouter/), "Stripe", "Supabase"]),
    );
    expect(screen.getAllByText(/standard contractual clauses/i).length).toBeGreaterThan(0);
  });

  it("prints every item stored in the browser, and says why there is no banner", () => {
    render(<PrivacyPage />);

    const section = screen.getByRole("region", { name: /cookies and storage/i });
    for (const item of STORAGE_ITEMS) {
      expect(within(section).getByText(item.key)).toBeInTheDocument();
    }
    expect(within(section).getByText(/no cookie banner/i)).toBeInTheDocument();
  });

  it("says voice is processed and the tutor is an AI", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/a voice recording is personal data/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /the tutor is an ai/i })).toBeInTheDocument();
  });

  it("states the rights and where the export and the deletion are", () => {
    render(<PrivacyPage />);

    const rights = screen.getByRole("region", { name: /your rights/i });
    expect(rights).toHaveTextContent(/Art\. 15/);
    expect(rights).toHaveTextContent(/Art\. 17/);
    expect(rights).toHaveTextContent(/Art\. 20/);
    expect(rights).toHaveTextContent(/Settings lets you export/i);
  });

  it("is public and canonical", () => {
    expect(privacyMetadata.alternates).toEqual({ canonical: "/legal/privacy" });
  });
});

describe("/legal/terms", () => {
  it("carries the version every order records", () => {
    render(<TermsPage />);

    expect(screen.getByText(`Version ${TERMS_VERSION}`)).toBeInTheDocument();
  });

  it("states the renewal rule for a yearly plan (§309 Nr. 9 BGB)", () => {
    render(<TermsPage />);

    expect(screen.getByText(/never renews into a second fixed year/i)).toBeInTheDocument();
  });

  it("links the cancellation page, the withdrawal page and the privacy policy", () => {
    render(<TermsPage />);

    expect(screen.getByRole("main").querySelector('a[href="/legal/cancel"]')).not.toBeNull();
    expect(screen.getByRole("main").querySelector('a[href="/legal/withdrawal"]')).not.toBeNull();
    expect(screen.getByRole("main").querySelector('a[href="/legal/privacy"]')).not.toBeNull();
  });

  it("restates what the order page commits to", () => {
    render(<TermsPage />);

    expect(screen.getByText(/all prices include vat/i)).toBeInTheDocument();
    expect(screen.getByText(/withdraw from an order within 14 days/i)).toBeInTheDocument();
    expect(screen.getByText(/order with obligation to pay/i)).toBeInTheDocument();
  });

  it("is no longer hidden from search", () => {
    expect(termsMetadata.robots).toBeUndefined();
    expect(termsMetadata.alternates).toEqual({ canonical: "/legal/terms" });
  });
});

describe("/legal/withdrawal", () => {
  it("gives the statutory instructions and the model form", () => {
    render(<WithdrawalPage />);

    expect(screen.getByText(/right to withdraw from this contract within 14 days/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /model withdrawal form/i })).toBeInTheDocument();
    expect(screen.getByText(/in proportion to what has been provided/i)).toBeInTheDocument();
  });

  it("points at the withdrawal button behind sign-in", () => {
    render(<WithdrawalPage />);

    expect(screen.getByRole("link", { name: /withdraw from contract/i })).toHaveAttribute("href", "/billing/withdraw");
  });

  it("is public and canonical", () => {
    expect(withdrawalMetadata.alternates).toEqual({ canonical: "/legal/withdrawal" });
  });
});
