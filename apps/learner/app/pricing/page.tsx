import type { Metadata } from "next";

import { eyebrow } from "@dp/ui/styles";

import { AlwaysFree } from "@/components/pricing/always-free";
import { ComparisonTable } from "@/components/pricing/comparison-table";
import { PassCards } from "@/components/pricing/pass-cards";
import { PlanCards } from "@/components/pricing/plan-cards";
import { JsonLd } from "@/components/seo/json-ld";
import { PublicFooter } from "@/components/site/public-footer";
import { PublicHeader } from "@/components/site/public-header";
import { currentPrices } from "@/lib/billing/catalogue";
import { PAYMENT_METHODS, PRICING_FAQ } from "@/lib/billing/copy";
import { offerCatalogue, passCards, planCards } from "@/lib/billing/offers";
import { pricingViewer } from "@/lib/billing/viewer";
import { siteEnv } from "@/lib/env/server";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { pricingStructuredData } from "@/lib/seo/structured-data";

export const metadata: Metadata = publicPageMetadata("/pricing");

const sectionHeading =
  "max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl";

/**
 * /pricing — the plans, the passes, and what never costs anything.
 *
 * Public and indexed, so it is the page a price is checked against. Every
 * figure is read from the Stripe mirror when the page is requested, and the
 * structured data is built from the same rows in the same request, so the
 * page a visitor reads and the markup a search engine reads cannot disagree
 * (billing-and-plans-spec.md S7). With no rows it says prices are being set
 * up; with an unreadable mirror it says they could not be loaded. It never
 * shows a number it was not given.
 *
 * Prices include VAT and say so, beside every one (spec S11).
 */
export default async function PricingPage() {
  const [prices, viewer] = await Promise.all([currentPrices(), pricingViewer()]);
  const catalogue = offerCatalogue(prices);

  return (
    <div className="flex min-h-dvh flex-col bg-ground font-body text-copy">
      <JsonLd data={pricingStructuredData(siteEnv().appUrl, catalogue)} />
      <PublicHeader />

      <main className="flex-1">
        <section
          aria-labelledby="pricing-heading"
          className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-16 md:px-10 md:py-20"
        >
          <div className="flex max-w-2xl flex-col gap-3">
            <p className={eyebrow}>Start free. Pay when it earns it.</p>
            <h1
              id="pricing-heading"
              className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl"
            >
              Plans and prices
            </h1>
            <p className="text-lg leading-relaxed text-copy/70">
              Free is a real plan with daily limits, and it never asks for a
              card. Plus and Premium add a stronger tutor, more conversation
              and a natural voice. Every price includes VAT, and you can
              cancel any time.
            </p>
          </div>

          {/* The cards name each plan as an h3, as they do under the landing
              page's h2; this one keeps the outline from jumping a level. */}
          <h2 className="sr-only">Subscriptions</h2>
          <PlanCards
            cards={planCards(catalogue, viewer)}
            surface="pricing"
            catalogueReadable={catalogue.readable}
          />

          <p className="max-w-3xl text-sm leading-relaxed text-copy/60">
            Pay by {PAYMENT_METHODS}, where available at checkout. Payment
            happens on Stripe&apos;s secure page; your card and bank details
            never reach us.
          </p>
        </section>

        {/* The one-off route, for anyone who would rather not hold a
            subscription at all. The landing page links here by anchor. */}
        <section id="passes" aria-labelledby="passes-heading" className="border-t border-edge/60 bg-panel">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16 md:px-10 md:py-20">
            <div className="flex flex-col gap-3">
              <h2 id="passes-heading" className={sectionHeading}>
                Prefer no subscription?
              </h2>
              <p className="max-w-xl text-lg leading-relaxed text-copy/70">
                A pass is one payment for a fixed stretch of Plus or Premium.
                Nothing renews, and there is nothing to cancel.
              </p>
            </div>
            <PassCards
              passes={passCards(catalogue, viewer)}
              surface="pricing"
              catalogueReadable={catalogue.readable}
            />
          </div>
        </section>

        <section aria-labelledby="compare-heading">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16 md:px-10 md:py-20">
            <h2 id="compare-heading" className={sectionHeading}>
              Every plan, side by side
            </h2>
            <ComparisonTable />
          </div>
        </section>

        <section aria-labelledby="always-free-heading" className="border-t border-edge/60 bg-panel">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-16 md:px-10 md:py-20">
            <h2 id="always-free-heading" className={sectionHeading}>
              Always free, on every plan
            </h2>
            <AlwaysFree />
            <p className="max-w-2xl leading-relaxed text-copy/70">
              No plan changes how you are assessed. Every plan gets the same
              evaluation, the same levels and the same curriculum; a plan buys
              more practice, never a different grade.
            </p>
          </div>
        </section>

        {/* Plain headings and paragraphs, as on the landing page: the same
            questions are in this page's structured data, and FAQ markup is
            only honoured when the page shows what it says. */}
        <section aria-labelledby="pricing-faq-heading" className="border-t border-edge/60">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16 md:px-10 md:py-20">
            <h2 id="pricing-faq-heading" className={sectionHeading}>
              Before you pay
            </h2>
            <div className="grid gap-8 md:grid-cols-2">
              {PRICING_FAQ.map((entry) => (
                <article key={entry.question} className="flex flex-col gap-2">
                  <h3 className="font-display text-lg font-semibold text-brand">{entry.question}</h3>
                  <p className="leading-relaxed text-copy/70">{entry.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
