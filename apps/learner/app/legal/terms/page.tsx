import type { Metadata } from "next";
import Link from "next/link";

import { TERMS_VERSION, TRIAL_DAYS } from "@dp/domain/billing";
import { eyebrow, linkInline, pageTitle, prose } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { PublicFooter } from "@/components/site/public-footer";
import { PublicHeader } from "@/components/site/public-header";
import { WITHDRAWAL_DAYS } from "@/lib/billing/copy";
import { BILLING_PATH, PRICING_PATH } from "@/lib/billing/offers";

/**
 * Not indexed while it is a placeholder: a search result for terms that do
 * not exist yet would be worse than none. Followed, so the links still count.
 */
export const metadata: Metadata = {
  title: "Terms and withdrawal",
  robots: { index: false, follow: true },
};

/**
 * The terms and withdrawal policy an order is placed under — NOT WRITTEN YET.
 *
 * billing-and-plans-spec.md S11 lists the terms, the withdrawal instructions
 * with the model form, the Impressum and the privacy policy as work for a
 * lawyer before the live Stripe key is configured (B10). The order page must
 * link somewhere, so this page exists and says plainly what it is: a stub,
 * with the commitments the order page itself already states, and nothing
 * that reads like drafted legal text.
 */
export default function TermsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-ground font-body text-copy">
      <PublicHeader shortcut={{ href: PRICING_PATH, label: "Pricing" }} />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12 md:px-10 md:py-16">
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>Version {TERMS_VERSION}</p>
          <h1 className={pageTitle}>Terms and withdrawal</h1>
        </div>

        <p role="note" className="rounded-2xl border border-ember/40 bg-ember/10 p-4 text-sm leading-relaxed">
          These terms are being finalised and are not published yet. This page will hold the
          full terms, the withdrawal instructions and the model withdrawal form.
        </p>

        <section aria-labelledby="commitments" className="flex flex-col gap-3">
          <h2 id="commitments" className="font-display text-lg font-semibold tracking-tight">
            What an order already says
          </h2>
          <ul className={cn(prose, "flex list-disc flex-col gap-2 pl-5 text-sm")}>
            <li>Prices include VAT.</li>
            <li>A subscription renews every month or every year until you cancel it.</li>
            <li>
              You can cancel any time on{" "}
              <Link href={BILLING_PATH} className={linkInline}>
                Plan &amp; billing
              </Link>
              ; the plan runs to the end of the period you have paid for.
            </li>
            <li>A pass is paid once and does not renew.</li>
            <li>
              You can withdraw within {WITHDRAWAL_DAYS} days of an order. Because the tutor starts
              straight away at your request, withdrawing means paying for the days already used.
            </li>
            <li>The {TRIAL_DAYS}-day Premium trial asks for no card and ends by itself.</li>
          </ul>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
