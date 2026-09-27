import Link from "next/link";

import { linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { BILLING_PATH } from "@/lib/billing/offers";
import type { BillingStanding } from "@/lib/billing/standing";
import { planStatusLine } from "@/lib/billing/status";

const sectionLabel =
  "font-display text-xs font-semibold uppercase tracking-[0.14em] text-copy/55";

/**
 * The plan as a strip, beside the level strip and for the same reason: it is
 * not changed here, only stated, with the way to where it is changed.
 */
export function PlanStrip({ standing }: { standing: BillingStanding }) {
  return (
    <section
      aria-labelledby="plan-heading"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-edge/70 bg-panel/50 px-4 py-2.5"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 id="plan-heading" className={sectionLabel}>
          Your plan
        </h2>
        <p className={cn("truncate text-sm", standing.readable ? "text-copy" : "text-copy/60")}>
          {planStatusLine(standing)}
        </p>
      </div>
      <Link href={BILLING_PATH} className={cn(linkInline, "font-display text-xs")}>
        Plan &amp; billing →
      </Link>
    </section>
  );
}
