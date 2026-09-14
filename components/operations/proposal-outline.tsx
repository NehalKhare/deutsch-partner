import { eyebrow, outlineLink } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

/**
 * The proposal page's outline.
 *
 * The page is the audit trail behind one decision, and the decision itself is
 * at the bottom of it — correctly, because nobody should be able to approve a
 * proposal without scrolling past the evidence for it. What was wrong was that
 * scrolling past was the *only* way back to it. This rail is the way back:
 * every section, in the order they appear, with the operator's own decision
 * named at the end and drawn in the accent when it is actually their move.
 *
 * Links rather than scroll-spy. Anchors are what the browser already does
 * well — they work on a folded section, they survive a refresh mid-run, and
 * they cost no measurement, no observer and no client component.
 *
 * Hidden below the large breakpoint, where a 13rem rail beside the content
 * would leave neither enough room. There the folded sections are the outline:
 * a page of closed headings is a list of headings.
 */

export interface OutlineItem {
  /** The id of the heading it points at. */
  readonly id: string;
  readonly label: string;
  readonly count?: number;
  /** Whose move it is. The accent is reserved for exactly that. */
  readonly accent?: boolean;
}

export function ProposalOutline({
  items,
}: {
  readonly items: readonly OutlineItem[];
}) {
  return (
    <nav
      aria-label="On this page"
      className="hidden lg:sticky lg:top-6 lg:block lg:self-start"
    >
      <p className={cn(eyebrow, "px-2.5 pb-2")}>On this page</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                outlineLink,
                item.accent && "text-apricot hover:text-apricot",
              )}
            >
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.count === undefined ? null : (
                <span className="shrink-0 text-xs tabular-nums text-chalk/35">
                  {item.count}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
