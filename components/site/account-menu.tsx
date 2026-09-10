"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { focusRing } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

/**
 * The account menu.
 *
 * Everything that is about *you* rather than about learning German: which
 * account you are in, your settings, the operations pages if you are an
 * operator, and the way out. None of those is a room to walk into, so none of them
 * belongs in the main navigation beside Chat and Catch up — and a sign-out link
 * sitting permanently in the open, one mis-click from ending a session, is the
 * worst of them.
 *
 * A disclosure holding links rather than an ARIA menu. The items are ordinary
 * links and one form button, so Tab already moves through them and Enter
 * already works; role="menu" would take that away and owe arrow keys, a
 * roving tabindex and typeahead in return, which is a great deal of machinery
 * to reimplement what the browser does correctly.
 */

export interface AccountMenuProps {
  /** What to show on the button — the address's local part, usually. */
  readonly label: string;
  /** Shown in full inside the menu: this is where you check which account. */
  readonly email: string | null;
  /** Operators get the two operations pages. Decided on the server, never here. */
  readonly isOperator: boolean;
  readonly signOut: () => Promise<void>;
}

const item =
  "block rounded-lg px-3 py-2 text-left font-display text-sm transition-colors";

export function AccountMenu({ label, email, isOperator, signOut }: AccountMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const labelId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Back where it came from. Escape that drops focus to the document is
      // Escape that strands a keyboard at the top of the page.
      trigger.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && container.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const links = [
    { href: "/settings", label: "Settings" },
    ...(isOperator
      ? [
          { href: "/operations/costs", label: "AI spend" },
          { href: "/operations/product", label: "Product ops" },
        ]
      : []),
  ];

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
            ? "border-apricot/50 bg-apricot/10 text-chalk"
            : "border-haze/60 text-chalk/70 hover:border-chalk/30 hover:text-chalk",
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
          "absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-haze/70 bg-dusk p-1.5",
          "shadow-lg shadow-ink/40",
        )}
      >
        {email ? (
          // Which account, in full. The button can only afford a fragment of
          // it, and a fragment is exactly what is ambiguous between two logins.
          <p className="truncate px-3 pt-1.5 pb-2 text-xs text-chalk/45" title={email}>
            {email}
          </p>
        ) : null}

        <div className="flex flex-col border-t border-haze/50 pt-1.5">
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
                  active ? "bg-apricot/15 text-apricot" : "text-chalk/75 hover:bg-haze/40 hover:text-chalk",
                  focusRing,
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Last, and separated. Ending the session is not the same kind of
            thing as opening a page, and it should not sit flush against one. */}
        <form action={signOut} className="mt-1.5 border-t border-haze/50 pt-1.5">
          <button
            type="submit"
            className={cn(item, "w-full text-chalk/75 hover:bg-haze/40 hover:text-chalk", focusRing)}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
