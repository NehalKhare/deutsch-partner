import { eyebrow, page, pageTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * What an operator page looks like before its read comes back.
 *
 * This exists for prefetching rather than for patience. Every route under
 * `/operations` is dynamic — an allowlist check and an uncached query — and
 * Next only prefetches a dynamic route as far as its nearest loading boundary.
 * Without one, clicking between the board and the runs page is a click,
 * a wait, and then a whole new page; with one, the header and the shape of
 * what is coming are already in the browser and only the rows arrive over the
 * wire.
 *
 * It draws the page's own header rather than a grey rectangle where the header
 * goes, because the title is the one part known before the query returns —
 * which makes the fallback say where you have arrived rather than that
 * something is happening.
 */
export function OpsSkeleton({
  title,
  bands = 3,
}: {
  readonly title: string;
  /** Roughly how many panels the real page has, so the fallback is its size. */
  readonly bands?: number;
}) {
  return (
    <main className={cn(page, "max-w-6xl")} aria-busy>
      <header className="flex flex-col gap-2">
        <p className={eyebrow}>Operations</p>
        <h1 className={pageTitle}>{title}</h1>
        <p className="sr-only" role="status">
          Loading.
        </p>
      </header>

      {Array.from({ length: bands }, (_, band) => (
        <div
          key={band}
          aria-hidden
          className="h-24 animate-pulse rounded-2xl border border-edge/70 bg-panel/40"
        />
      ))}
    </main>
  );
}
