import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

/**
 * The shell for the pages a learner passes through rather than works in:
 * signing in, signing up, setting up, and getting lost.
 *
 * These sat on a blank page with no name on them, which is exactly where a
 * visitor is least sure they are still on the same site. The companion is not
 * here — it belongs to the conversation, and putting it beside a password
 * field would spend it.
 */
export function QuietShell({
  children,
  width = "narrow",
  footer,
}: {
  children: React.ReactNode;
  /** Onboarding is a form with real content in it; the rest is a card. */
  width?: "narrow" | "wide";
  /**
   * What stands at the foot of the page. The learner app puts its legal
   * links here on every shell, because the law wants them on every page
   * and a sign-in card is a page; the shell itself knows nothing about them.
   */
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-ground font-body text-copy">
      <header className="flex items-center justify-between gap-4 px-6 py-4 md:px-10">
        <Wordmark />
        {/* Signing in is the one place a reader is on this product without an
            account to hang a preference on, so the switch has to be here too. */}
        <ThemeToggle hideLegend />
      </header>
      <main
        className={[
          "mx-auto flex w-full flex-1 flex-col gap-8 px-6 pb-16 md:px-10",
          width === "narrow"
            ? "max-w-md justify-center pt-4"
            : "max-w-2xl pt-6",
        ].join(" ")}
      >
        {children}
      </main>
      {footer}
    </div>
  );
}
