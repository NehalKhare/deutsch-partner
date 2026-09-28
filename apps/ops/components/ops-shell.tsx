import { betaPill } from "@dp/ui/styles";
import { Wordmark } from "@dp/ui/wordmark";
import { accountLabel } from "@dp/auth/account";

import { HOME_PATH } from "@/lib/auth/routes";
import { OpsAccountMenu } from "@/components/ops-account-menu";
import { OpsNav, tabBarSpace } from "@/components/ops-nav";

/**
 * The operator shell: a header across the top, and the page below it.
 *
 * The same frame as the learner's, in the operator's palette, so the two
 * products are one pattern to learn. Four rooms fit a centred row with room to
 * spare, which is what the rail was for; the rail had stopped earning the
 * 15rem of width it took from a ten-screen proposal.
 *
 * Mobile first. On a phone the header holds the wordmark, the beta pill and
 * the account, and the rooms move to a tab bar at the foot (OpsNav pins
 * itself there). The pill stays at every size: "Operations" is a label the
 * operator can do without on a small screen, whereas that the whole product
 * is still in beta is worth the room. From
 * `md` up the header is three columns with the outer two equal, so the rooms
 * sit on the true centre however long the account name is. No
 * backdrop-filter or transform on the header: either would become the
 * containing block for the fixed tab bar and drag it up here.
 *
 * Only the two leaves that need the browser are client components: the nav,
 * because the current page should say so, and the account menu, because it
 * opens and closes. The shell itself stays on the server.
 *
 * The shell is exactly one viewport tall and scrolls nothing; the region below
 * the header carries the overflow. That is what lets the live run feed and the
 * proposal outline keep a fixed head above a scrolling body. The spacer under
 * it keeps the tab bar's height clear on a phone.
 */
export interface OpsShellProps {
  readonly email: string | null;
  readonly signOut: () => Promise<void>;
  readonly children: React.ReactNode;
}

export function OpsShell({ email, signOut, children }: OpsShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-ground font-body text-copy">
      <header className="flex items-center justify-between gap-4 border-b border-edge/60 px-4 py-2.5 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr] md:justify-items-start md:py-3 lg:px-10">
        <div className="flex items-center gap-3">
          <Wordmark href={HOME_PATH} />
          <span className="hidden rounded-full border border-brand/40 px-2 py-0.5 font-display text-xs uppercase tracking-wide text-brand sm:inline">
            Operations
          </span>
          <span className={betaPill}>Beta</span>
        </div>

        <OpsNav />

        <div className="md:justify-self-end">
          <OpsAccountMenu label={accountLabel(email)} email={email} signOut={signOut} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      <div aria-hidden className={tabBarSpace} />
    </div>
  );
}
