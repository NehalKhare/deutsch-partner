import Link from "next/link";

import { betaPill } from "@dp/ui/styles";
import { Wordmark } from "@dp/ui/wordmark";

/**
 * The header of the pages a visitor reads before they have an account: the
 * landing page, the prices, the terms.
 *
 * The way in is always the same two links, so a visitor who has just read a
 * price is one press from starting free. The extra link is the page's own
 * shortcut — the landing page's to its plans, the terms' to the prices — and
 * is left out where it would point at the page it sits on. From `sm` up
 * only: on a phone the wordmark and the two ways in already fill the row,
 * and the plans are a scroll away. A shortcut to something still in beta
 * says so beside it, as every other link to it does.
 */
export function PublicHeader({
  shortcut,
}: {
  shortcut?: { readonly href: string; readonly label: string; readonly beta?: boolean };
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-edge/60 px-6 py-4 md:px-10">
      <Wordmark />
      <nav className="flex items-center gap-4 text-sm sm:gap-5">
        {shortcut ? (
          <span className="hidden items-center gap-2 sm:flex">
            <Link
              href={shortcut.href}
              className="text-copy/70 underline-offset-4 hover:text-copy hover:underline"
            >
              {shortcut.label}
            </Link>
            {shortcut.beta ? <span className={betaPill}>Beta</span> : null}
          </span>
        ) : null}
        <Link
          href="/auth/login"
          className="text-copy/70 underline-offset-4 hover:text-copy hover:underline"
        >
          Sign in
        </Link>
        <Link
          href="/auth/sign-up"
          className="rounded-full border border-brand px-4 py-1.5 font-display text-brand hover:bg-brand/10"
        >
          Start free
        </Link>
      </nav>
    </header>
  );
}
