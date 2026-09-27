import Link from "next/link";

import { linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { PlanCards } from "@/components/pricing/plan-cards";
import { ALWAYS_FREE_SHORT } from "@/lib/billing/copy";
import {
  PRICING_PATH,
  cheapestPass,
  planCards,
  type OfferCatalogue,
  type PricingViewer,
} from "@/lib/billing/offers";

/**
 * The plans, on the landing page, so a visitor sees what it costs without
 * leaving the page they are deciding on.
 *
 * The same cards as /pricing, from the same component, in the landing page's
 * register: a heading that says what the deal is, one line under it, the
 * cards, and the two ways on — the passes and the full comparison. A price
 * the mirror does not hold becomes "See pricing"; the section itself always
 * renders, because a failed read of a price list must never cost the page.
 */
export function PlansSection({
  catalogue,
  viewer,
}: {
  readonly catalogue: OfferCatalogue;
  readonly viewer: PricingViewer;
}) {
  const pass = cheapestPass(catalogue);

  return (
    <section id="plans" aria-labelledby="plans-heading" className="border-t border-edge/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-16 md:px-10 md:py-24">
        <div className="flex flex-col gap-3">
          <h2
            id="plans-heading"
            className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl"
          >
            Start free. Pay when it earns it.
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-copy/70">
            Free is a real plan, not a countdown: a conversation partner every
            day, and no card. Plus and Premium add a stronger tutor, more of
            it, and a natural voice.
          </p>
        </div>

        <PlanCards
          cards={planCards(catalogue, viewer)}
          surface="landing"
          catalogueReadable={catalogue.readable}
        />

        <div className="flex flex-col gap-3 font-display text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-copy/65">
            Prefer to pay once?{" "}
            <Link href={`${PRICING_PATH}#passes`} className={linkInline}>
              {/* A price shown says VAT is in it (spec S11), here as on every card. */}
              {pass ? `Passes from ${pass.amount} incl. VAT` : "See the passes"}
            </Link>
          </p>
          <Link href={PRICING_PATH} className={cn(linkInline, "self-start sm:self-auto")}>
            Compare every feature →
          </Link>
        </div>

        <p className="max-w-3xl border-t border-edge/50 pt-6 text-sm leading-relaxed text-copy/65">
          <span className="font-display font-semibold text-copy">Always free on every plan:</span>{" "}
          {ALWAYS_FREE_SHORT}
        </p>
      </div>
    </section>
  );
}
