import Link from "next/link";

import { buttonQuiet, linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { PRICING_PATH, type PassCardView } from "@/lib/billing/offers";

/**
 * "Prefer no subscription?": one payment for a fixed number of days.
 *
 * The length is the Price's own pass_days as Stripe holds it, so a pass
 * changed in the Dashboard and synced says its new length here with no
 * deploy. Nothing renews and there is nothing to cancel, and the card says
 * both, because that is the whole point of choosing it.
 */

export interface PassCardsProps {
  readonly passes: readonly PassCardView[];
  readonly surface: "landing" | "pricing";
  readonly catalogueReadable: boolean;
}

export function PassCards({ passes, surface, catalogueReadable }: PassCardsProps) {
  return (
    <ul aria-label="Passes" className="grid gap-4 sm:grid-cols-2">
      {passes.map((pass) => {
        const headingId = `pass-${pass.plan}`;
        return (
          <li
            key={pass.plan}
            aria-labelledby={headingId}
            className="flex flex-col gap-3 rounded-2xl border border-edge/70 bg-panel/50 p-5"
          >
            <h3 id={headingId} className="font-display text-lg font-semibold text-brand">
              {pass.name} pass
            </h3>

            {pass.price ? (
              <div className="flex flex-col gap-0.5">
                <p className="flex items-baseline gap-1.5">
                  <span className="font-display text-2xl font-semibold tracking-tight tabular-nums">
                    {pass.price.amount}
                  </span>
                  <span className="text-sm text-copy/60">once · incl. VAT</span>
                </p>
                {pass.price.passDays !== null ? (
                  <p className="text-sm text-copy/75">
                    {pass.price.passDays} days of {pass.name}
                  </p>
                ) : null}
              </div>
            ) : surface === "landing" ? (
              <Link href={PRICING_PATH} className={cn(linkInline, "self-start font-display text-sm")}>
                See pricing
              </Link>
            ) : (
              <p className="text-sm text-copy/60">
                {catalogueReadable ? "Prices are being set up." : "Prices could not be loaded just now."}
              </p>
            )}

            <p className="text-sm leading-relaxed text-copy/65">
              One payment, no renewal and nothing to cancel. A second pass adds its days after the first.
            </p>

            {pass.cta ? (
              <Link href={pass.cta.href} className={cn(buttonQuiet, "mt-auto self-start")}>
                {pass.cta.label}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
