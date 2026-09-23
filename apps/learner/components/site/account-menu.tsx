"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { focusRing } from "@dp/ui/styles";
import { ThemeToggle } from "@dp/ui/theme-toggle";
import { useDisclosure } from "@dp/ui/use-disclosure";
import { cn } from "@dp/ui/utils";

/**
 * The account menu.
 *
 * Everything that is about *you* rather than about learning German: which
 * account you are in, your settings, and the way out. None of those is a room
 * to walk into, so none of them belongs in the main navigation beside Chat and
 * Catch up — and a sign-out link sitting permanently in the open, one mis-click
 * from ending a session, is the worst of them. The operator pages are a
 * separate product on a separate origin and are not linked from here.
 *
 * A disclosure holding links rather than an ARIA menu. The items are ordinary
 * links and one form button, so Tab already moves through them and Enter
 * already works; role="menu" would take that away and owe arrow keys, a
 * roving tabindex and typeahead in return, which is a great deal of machinery
 * to reimplement what the browser does correctly.
 *
 * Opening, closing, Escape and the click outside are `useDisclosure` in
 * `@dp/ui`, shared with the operator app's own menu. What stays here is the
 * drawing and the items, which are this product's and not that one's.
 */

export interface AccountMenuProps {
  /** What to show on the button — the address's local part, usually. */
  readonly label: string;
  /** Shown in full inside the menu: this is where you check which account. */
  readonly email: string | null;
  readonly signOut: () => Promise<void>;
}

const item =
  "block rounded-lg px-3 py-2 text-left font-display text-sm transition-colors";

export function AccountMenu({ label, email, signOut }: AccountMenuProps) {
  const pathname = usePathname();
  const { open, setOpen, container, trigger } = useDisclosure();
  const panelId = useId();
  const labelId = useId();

  const links = [{ href: "/settings", label: "Settings" }];

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        id={labelId}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex max-w-[12rem] items-center gap-1.5 rounded-full border px-3 py-1.5",
          "font-display text-sm transition-colors",
          open
            ? "border-brand/50 bg-brand/10 text-copy"
            : "border-edge/60 text-copy/70 hover:border-copy/30 hover:text-copy",
          focusRing,
        )}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden className={cn("text-xs transition-transform", open && "rotate-180")}>
          ▾
        </span>
      </button>

      <div
        id={panelId}
        aria-labelledby={labelId}
        hidden={!open}
        className={cn(
          "absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-edge/70 bg-raised p-1.5",
          "shadow-lg shadow-shade/40",
        )}
      >
        {email ? (
          // Which account, in full. The button can only afford a fragment of
          // it, and a fragment is exactly what is ambiguous between two logins.
          <p className="truncate px-3 pt-1.5 pb-2 text-xs text-copy/65" title={email}>
            {email}
          </p>
        ) : null}

        <div className="flex flex-col border-t border-edge/50 pt-1.5">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                // Closed by the click that navigates. A menu still hanging
                // open over the page it just opened reads as a bug — and a
                // click anywhere else is already handled as a click outside.
                onClick={() => setOpen(false)}
                className={cn(
                  item,
                  active ? "bg-brand/15 text-brand" : "text-copy/75 hover:bg-edge/40 hover:text-copy",
                  focusRing,
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Light or dark is about you rather than about German, which is
            what this menu is for. In the panel rather than the bar because it
            is set once and then not thought about again — a control that
            permanently occupies the header would outrank Catch up. */}
        <div className="mt-1.5 border-t border-edge/50 px-3 pt-2.5 pb-1.5">
          <ThemeToggle />
        </div>

        {/* Last, and separated. Ending the session is not the same kind of
            thing as opening a page, and it should not sit flush against one. */}
        <form action={signOut} className="mt-1.5 border-t border-edge/50 pt-1.5">
          <button
            type="submit"
            className={cn(item, "w-full text-copy/75 hover:bg-edge/40 hover:text-copy", focusRing)}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
