import Link from "next/link";

import { Wordmark } from "@dp/ui/wordmark";
import { focusRing } from "@dp/ui/styles";
import { ThemeToggle } from "@dp/ui/theme-toggle";
import { cn } from "@dp/ui/utils";

/**
 * The operator shell: a header with the two rooms and the way out.
 *
 * Deliberately plainer than the learner's: this is a tool, not a product, and
 * the only person who ever sees it already knows where they are.
 */
export interface OpsShellProps {
  readonly email: string | null;
  readonly signOut: () => Promise<void>;
  readonly children: React.ReactNode;
}

const navLink = cn(
  "rounded-full px-3 py-1.5 font-display text-sm text-copy/75 transition-colors hover:bg-edge/40 hover:text-copy",
  focusRing,
);

export function OpsShell({ email, signOut, children }: OpsShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-ground font-body text-copy">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-edge/60 px-6 py-4 md:px-10">
        <div className="flex items-center gap-4">
          <Wordmark href="/product" />
          <span className="rounded-full border border-apricot/40 px-2 py-0.5 font-display text-xs uppercase tracking-wide text-apricot">
            Operations
          </span>
        </div>
        <nav aria-label="Operations" className="flex items-center gap-1">
          <Link href="/product" className={navLink}>
            Product ops
          </Link>
          <Link href="/product/runs" className={navLink}>
            Runs
          </Link>
          <Link href="/costs" className={navLink}>
            AI spend
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          {/* Operators read this one for hours at a time, so the switch is in
              the open here rather than behind a menu. */}
          <ThemeToggle hideLegend />
          {email ? <span className="text-sm text-copy/60">{email}</span> : null}
          <form action={signOut}>
            <button type="submit" className={navLink}>
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
