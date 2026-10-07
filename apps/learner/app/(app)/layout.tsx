import type { Metadata } from "next";

import { signOutAction } from "@/app/auth/actions";
import { AccountMenu } from "@/components/site/account-menu";
import { AppNav, tabBarSpace } from "@/components/site/app-nav";
import { Wordmark } from "@dp/ui/wordmark";
import { accountLabel } from "@dp/auth/account";
import { requireAuthenticatedAccount } from "@/lib/auth/current-user";
import { currentSummary } from "@/lib/dashboard/current-summary";
import { requireOnboarded } from "@/lib/onboarding/gate";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo/metadata";

/** Every room is a learner's own. None is ever indexed. */
export const metadata: Metadata = PRIVATE_PAGE_METADATA;

/**
 * The authenticated shell.
 *
 * Guarding here rather than in each page means a new route under this segment
 * is protected by default: signed in with both factors, and set up. The proxy
 * also redirects, and the database enforces access independently: three
 * layers, none of them relied on alone.
 *
 * Visually it is the landing page's header with one thing swapped out, so
 * signing in changes what you can do and not what room you are standing in.
 *
 * The shell is exactly one viewport tall and scrolls nothing itself. That is
 * what lets a page own its own scrolling: the conversation and the trainer
 * both put a fixed head above a scrolling transcript, and an inner
 * overflow-y-auto only clips when something above it has a real height to
 * clip against. Left to grow (min-h-dvh), the document scrolled instead and
 * took the tutor's face up and off the screen with it. Ordinary pages scroll
 * in the region below the nav, which is why it carries the overflow.
 *
 * On a phone the rooms move to a tab bar at the foot of the screen. The bar is
 * fixed, and the spacer under the scrolling region keeps the same height clear,
 * so a page's sticky composer comes to rest above the bar instead of under it.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = await requireAuthenticatedAccount();
  await requireOnboarded(account.id);

  // For the count beside Catch up. Shared with the dashboard page through a
  // per-request memo, so a dashboard visit still runs this aggregate once.
  // A read that fails yields nothing waiting: an unreadable database must not
  // invent urgency in the nav bar.
  const summary = await currentSummary();
  const dueCount = summary.ok ? summary.data.vocabulary.due : 0;

  return (
    <div className="flex h-dvh flex-col bg-ground font-body text-copy">
      {/* Phone: wordmark and account, with the rooms in a tab bar at the
          foot (AppNav pins itself there). Desktop: three columns, the outer
          two equal, so the rooms sit on the true centre of the page however
          long the account name is. No backdrop-filter or transform on the
          header — either would become the containing block for the fixed
          tab bar and drag it up here. */}
      <header className="flex items-center justify-between gap-4 border-b border-edge/60 px-4 py-2.5 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr] md:justify-items-start md:py-3 lg:px-10">
        <Wordmark href="/dashboard" />
        <AppNav dueCount={dueCount} />
        {/* Everything about the account rather than about German: which one
            you are in, its settings, and the way out. */}
        <div className="md:justify-self-end">
          <AccountMenu
            label={accountLabel(account.email)}
            email={account.email}
            signOut={signOutAction}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      <div aria-hidden className={tabBarSpace} />
    </div>
  );
}
