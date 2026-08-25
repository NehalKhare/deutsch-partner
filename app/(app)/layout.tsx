import { signOutAction } from "@/app/auth/actions";
import { AppNav } from "@/components/site/app-nav";
import { Wordmark } from "@/components/site/wordmark";
import { focusRing } from "@/components/ui/styles";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { requireOnboarded } from "@/lib/onboarding/gate";

/**
 * The authenticated shell.
 *
 * Guarding here rather than in each page means a new route under this segment
 * is protected by default: signed in, and set up. The proxy also redirects, and
 * the database enforces access independently: three layers, none of them relied
 * on alone.
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
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const learnerId = await requireAuthenticatedUserId();
  await requireOnboarded(learnerId);

  return (
    <div className="flex h-dvh flex-col bg-ink font-body text-chalk">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-haze/60 px-6 py-4 md:px-10">
        <Wordmark href="/dashboard" />
        <AppNav />
        <form action={signOutAction}>
          <button
            type="submit"
            className={`rounded-sm font-display text-sm text-chalk/60 underline-offset-4 transition-colors hover:text-chalk hover:underline ${focusRing}`}
          >
            Sign out
          </button>
        </form>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
