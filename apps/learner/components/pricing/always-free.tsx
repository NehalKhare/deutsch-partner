import { Check } from "lucide-react";

import { cn } from "@dp/ui/utils";

import { ALWAYS_FREE } from "@/lib/billing/copy";

/**
 * What no plan gates, ever (billing-and-plans-spec.md S4).
 *
 * Beside every price, because the fear a paywall raises is not "what will
 * this cost" but "what will I lose": the review queue a learner has already
 * climbed, the curriculum they were promised had no locked chapters. None of
 * it costs anything to serve, and none of it is for sale.
 */
export function AlwaysFree({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <ul
      aria-label="Always free on every plan"
      className={cn("grid gap-2 text-sm text-copy/75", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {ALWAYS_FREE.map((line) => (
        <li key={line} className="flex gap-2">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sprout" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}
