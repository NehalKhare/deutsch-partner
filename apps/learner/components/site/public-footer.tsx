import Link from "next/link";

import { betaPill } from "@dp/ui/styles";

import { PRICING_PATH, TERMS_PATH } from "@/lib/billing/offers";

const footerLink = "underline-offset-4 hover:text-copy hover:underline";

/**
 * The foot of every public page. What the product is in a sentence, where
 * the prices are, and the terms an order refers to.
 */
export function PublicFooter() {
  return (
    <footer className="flex flex-col gap-3 border-t border-edge/60 px-6 py-6 text-sm text-copy/40 sm:flex-row sm:items-center sm:justify-between md:px-10">
      <p>Deutsch Partner — an AI conversation partner for learning German.</p>
      <nav aria-label="Site" className="flex items-center gap-5">
        <span className="flex items-center gap-2">
          <Link href={PRICING_PATH} className={footerLink}>
            Pricing
          </Link>
          <span className={betaPill}>Beta</span>
        </span>
        <Link href={TERMS_PATH} className={footerLink}>
          Terms
        </Link>
      </nav>
    </footer>
  );
}
