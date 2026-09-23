import {
  disclosure,
  disclosureBody,
  disclosureSummary,
  sectionTitle,
} from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * One foldable section of the proposal page.
 *
 * A server component over native <details>, which is the whole reason this is
 * not a hook. The proposal page refreshes itself every few seconds while a run
 * is working, and a fold kept in React state would spring back open — or shut —
 * under the operator every time the poll landed. The browser owns the open
 * flag here, so a refresh cannot touch it.
 *
 * The heading keeps the id it had before this was foldable, so every
 * `aria-labelledby` and every outline link still lands on it. It sits inside
 * the summary rather than above it, which means a folded section is still a
 * heading in the document outline and still an anchor worth jumping to: the
 * outline can send you to a section you have not opened yet.
 */
export function SectionPanel({
  id,
  title,
  count,
  defaultOpen = false,
  children,
}: {
  /** The heading's id. Also the outline's anchor, so it must not change. */
  readonly id: string;
  readonly title: string;
  /** How many things are inside, when that is the useful thing to know folded. */
  readonly count?: number;
  readonly defaultOpen?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <details open={defaultOpen} className={cn(disclosure, "group")}>
        <summary className={disclosureSummary}>
          <h2 id={id} className={cn(sectionTitle, "scroll-mt-6")}>
            {title}
          </h2>
          {count === undefined ? null : (
            <span className="font-display text-xs tabular-nums text-chalk/40">
              {count}
            </span>
          )}
          {/* The only thing on the row that is not content, so it is the only
              thing that moves — and it does not move for anyone who has asked
              their system not to animate. */}
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={cn(
              "ml-auto size-3 shrink-0 text-chalk/40 transition-transform",
              "group-open:rotate-180 motion-reduce:transition-none",
            )}
          >
            <path
              d="M2 4.5 6 8.5 10 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className={disclosureBody}>{children}</div>
      </details>
    </section>
  );
}
