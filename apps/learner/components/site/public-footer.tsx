import Link from "next/link";

import { betaPill } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { PRICING_PATH } from "@/lib/billing/offers";
import {
  CANCEL_CONTRACT_PATH,
  IMPRESSUM_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
  WITHDRAWAL_PATH,
} from "@/lib/legal/routes";

const footerLink = "underline-offset-4 hover:text-copy hover:underline";

/**
 * The legal links every page must carry, in the order a reader looks for them.
 *
 * The Impressum and the privacy policy are required on every page of a German
 * site (§5 DDG, Art. 13 GDPR, both "easily recognisable and directly
 * reachable"). "Cancel contracts here" is the §312k BGB button: it has to be
 * on every page, it has to say those words, and it has to work without
 * signing in. One component, so a page cannot drop one of them by accident —
 * a test renders each shell and looks for all five.
 */
export const LEGAL_LINKS = [
  { href: IMPRESSUM_PATH, label: "Impressum" },
  { href: PRIVACY_PATH, label: "Privacy" },
  { href: TERMS_PATH, label: "Terms" },
  { href: WITHDRAWAL_PATH, label: "Withdrawal" },
  { href: CANCEL_CONTRACT_PATH, label: "Cancel contracts here" },
] as const;

export function LegalLinks({ className }: { readonly className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {LEGAL_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={footerLink}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The foot of every public page. What the product is in a sentence, where
 * the prices are, and the legal pages an order refers to.
 */
export function PublicFooter() {
  return (
    <footer className="flex flex-col gap-3 border-t border-edge/60 px-6 py-6 text-sm text-copy/40 md:px-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>Deutsch Partner — an AI conversation partner for learning German.</p>
        <nav aria-label="Site" className="flex items-center gap-5">
          <span className="flex items-center gap-2">
            <Link href={PRICING_PATH} className={footerLink}>
              Pricing
            </Link>
            <span className={betaPill}>Beta</span>
          </span>
        </nav>
      </div>
      <LegalLinks />
    </footer>
  );
}

/**
 * The same links in one quiet line, for the shells that have no room for a
 * footer: the signed-in app (one viewport tall, the tab bar at its foot) and
 * the cards a visitor passes through on the way in. A learner in the middle
 * of a conversation is still a consumer the cancellation button must reach.
 */
export function CompactLegalFooter() {
  return (
    <footer className="border-t border-edge/60 px-4 py-1.5 text-xs text-copy/40 sm:px-6 lg:px-10">
      <LegalLinks className="gap-x-3" />
    </footer>
  );
}
