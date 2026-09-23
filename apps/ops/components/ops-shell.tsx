import { Wordmark } from "@dp/ui/wordmark";
import { accountLabel } from "@dp/auth/account";

import { OpsAccountMenu } from "@/components/ops-account-menu";
import { OpsNav } from "@/components/ops-nav";

/**
 * The operator shell: a rail down the left, and the page beside it.
 *
 * A sidebar rather than a top bar because this is a tool somebody has open all
 * day across four rooms. A row of tabs has to stay short to stay a row, and it
 * had already stopped being one — the fourth room would have pushed the
 * account controls onto a second line at any window narrower than a desktop.
 * Down the side there is room for the names to be the names, and where you are
 * stays on the screen while you read a proposal that is ten screens long.
 *
 * Only the two leaves that need the browser are client components: the nav,
 * because the current page should say so, and the account menu, because it
 * opens and closes. The shell itself stays on the server.
 *
 * The rail is exactly one viewport tall and scrolls nothing; the region beside
 * it carries the overflow. That is what lets the live run feed and the
 * proposal outline keep a fixed head above a scrolling body.
 *
 * Below `md` the rail lies down and becomes a strip across the top, with the
 * rooms in a horizontal scroller. An operator on a phone is rare, but a
 * laptop at half width is not.
 */
export interface OpsShellProps {
  readonly email: string | null;
  readonly signOut: () => Promise<void>;
  readonly children: React.ReactNode;
}

export function OpsShell({ email, signOut, children }: OpsShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-ground font-body text-copy md:h-dvh md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-edge/60 px-4 py-4 md:h-dvh md:w-60 md:border-r md:border-b-0 md:px-5 md:py-6">
        <div className="flex items-center gap-3">
          <Wordmark href="/product" />
          <span className="rounded-full border border-brand/40 px-2 py-0.5 font-display text-xs uppercase tracking-wide text-brand">
            Operations
          </span>
        </div>

        <OpsNav />

        {/* Pinned to the foot on a rail, inline on the strip. */}
        <div className="md:mt-auto">
          <OpsAccountMenu
            label={accountLabel(email)}
            email={email}
            signOut={signOut}
          />
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col md:overflow-y-auto">{children}</div>
    </div>
  );
}
