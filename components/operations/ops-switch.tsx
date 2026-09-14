import Link from "next/link";

import { buttonPrimary, buttonQuiet } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

/**
 * The way across, between the two halves of product ops.
 *
 * The board is two jobs that want different things from a page. Deciding on a
 * proposal is reading and judging, and wants nothing moving on the screen.
 * Starting a scan and watching a run is operating, and the panel that does it
 * polls itself every six seconds. Splitting them let each page be one job —
 * but a split is only as good as the route back, so both directions live here
 * rather than being written twice: the destination is named the same word
 * wherever it is drawn, which is what makes it a place rather than a link.
 *
 * `prefetch` is left at its default. Both routes are dynamic — an operator
 * gate and an uncached read — so Next fetches each one down to its
 * `loading.tsx` boundary as the link enters the viewport, and the click lands
 * on a shell that is already there.
 */

/** The proposals board: the main page, and where a decision is made. */
export const PROPOSALS_PATH = "/operations/product";

/** Scans, the runs they start, and what learners said about the trainer. */
export const RUNS_PATH = "/operations/product/runs";

type Destination = "proposals" | "runs";

const DESTINATIONS: Readonly<
  Record<Destination, { readonly href: string; readonly label: string; readonly arrow: string }>
> = {
  // Back to the main page, so the arrow points the way the operator came.
  proposals: { href: PROPOSALS_PATH, label: "Proposals", arrow: "←" },
  runs: { href: RUNS_PATH, label: "Market scans & runs", arrow: "→" },
};

export function OpsSwitch({
  to,
  tone = "loud",
  className,
}: {
  readonly to: Destination;
  /**
   * Loud is the page's own call to action, in its header. Quiet is the same
   * destination offered beside something that points at it — a figure whose
   * detail lives over there — where a filled pill would outshout the numbers.
   */
  readonly tone?: "loud" | "quiet";
  readonly className?: string;
}) {
  const destination = DESTINATIONS[to];

  return (
    <Link
      href={destination.href}
      className={cn(tone === "loud" ? buttonPrimary : buttonQuiet, className)}
    >
      {to === "proposals" ? (
        <span aria-hidden className="mr-2">
          {destination.arrow}
        </span>
      ) : null}
      {destination.label}
      {to === "runs" ? (
        <span aria-hidden className="ml-2">
          {destination.arrow}
        </span>
      ) : null}
    </Link>
  );
}
