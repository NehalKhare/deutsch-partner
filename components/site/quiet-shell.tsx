import { Wordmark } from "@/components/site/wordmark";

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
}: {
  children: React.ReactNode;
  /** Onboarding is a form with real content in it; the rest is a card. */
  width?: "narrow" | "wide";
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink font-body text-chalk">
      <header className="flex items-center px-6 py-4 md:px-10">
        <Wordmark />
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
    </div>
  );
}
