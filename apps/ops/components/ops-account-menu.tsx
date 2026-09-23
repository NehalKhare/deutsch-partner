"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";

import { focusRing } from "@dp/ui/styles";
import { ThemeToggle } from "@dp/ui/theme-toggle";
import { useDisclosure } from "@dp/ui/use-disclosure";
import { cn } from "@dp/ui/utils";

/**
 * Who is signed in, the theme, and the way out.
 *
 * None of them is navigation and none is read more than once a session, so
 * in the open they would outrank the four rooms beside them. Behind one button
 * at the right of the header they cost an avatar.
 *
 * It opens downward against the right edge, as the learner's does. On a phone
 * the button is the avatar alone; the name joins it from `sm` up.
 *
 * A disclosure rather than an ARIA menu, and the opening and closing is
 * `useDisclosure` from `@dp/ui`, shared with the learner's account menu.
 */

export interface OpsAccountMenuProps {
  /** The address's local part, usually: what the button can afford to show. */
  readonly label: string;
  readonly email: string | null;
  readonly signOut: () => Promise<void>;
}

export function OpsAccountMenu({ label, email, signOut }: OpsAccountMenuProps) {
  const { open, setOpen, container, trigger } = useDisclosure();
  const panelId = useId();
  const labelId = useId();

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
          "flex max-w-[13rem] items-center gap-2 rounded-full border p-1 sm:pr-3",
          "font-display text-sm transition-colors",
          open
            ? "border-brand/50 bg-brand/10 text-copy"
            : "border-edge/60 text-copy/70 hover:border-copy/30 hover:text-copy",
          focusRing,
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 font-semibold text-brand uppercase"
        >
          {label.charAt(0)}
        </span>
        {/* Visually hidden rather than display:none on a phone, so the
            button's accessible name is still whose account it is. The
            truncation is on the inner span because not-sr-only resets the
            overflow and wrapping that truncate relies on. */}
        <span className="sr-only sm:not-sr-only sm:min-w-0">
          <span className="block truncate">{label}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "hidden size-3.5 shrink-0 transition-transform sm:block",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={panelId}
        aria-labelledby={labelId}
        hidden={!open}
        className={cn(
          "absolute right-0 z-40 mt-2 w-[min(15rem,calc(100vw-2rem))] rounded-2xl border",
          "border-edge/70 bg-raised p-1.5 shadow-lg shadow-shade/40",
        )}
      >
        {email ? (
          // Which account, in full. The button can only afford a fragment of
          // it, and a fragment is exactly what is ambiguous between two logins.
          <p className="truncate px-3 pt-1.5 pb-2 text-xs text-copy/65" title={email}>
            {email}
          </p>
        ) : null}

        <div className="border-t border-edge/50 px-3 pt-2.5 pb-1.5">
          <ThemeToggle />
        </div>

        {/* Last, and separated. Ending the session is not the same kind of
            thing as changing the theme, and it should not sit flush against
            one. */}
        <form action={signOut} className="mt-1.5 border-t border-edge/50 pt-1.5">
          <button
            type="submit"
            className={cn(
              "block w-full rounded-lg px-3 py-2 text-left font-display text-sm",
              "text-copy/75 transition-colors hover:bg-edge/40 hover:text-copy",
              focusRing,
            )}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
