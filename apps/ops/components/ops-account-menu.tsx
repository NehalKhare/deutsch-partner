"use client";

import { useId } from "react";

import { focusRing } from "@dp/ui/styles";
import { ThemeToggle } from "@dp/ui/theme-toggle";
import { useDisclosure } from "@dp/ui/use-disclosure";
import { cn } from "@dp/ui/utils";

/**
 * Who is signed in, the theme, and the way out.
 *
 * The three of these used to sit in the open along the top bar. None of them
 * is navigation and none is read more than once a session, so on a rail they
 * would take the foot of the sidebar and outrank the four rooms above them.
 * Behind one button they cost a line.
 *
 * It opens upward, because it is pinned to the bottom of the rail and a panel
 * opening downward from there is a panel off the screen. Below `md` the rail
 * is a strip across the top instead, and it opens downward again.
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
          "flex w-full items-center gap-1.5 rounded-lg border px-3 py-2",
          "font-display text-sm transition-colors",
          open
            ? "border-brand/50 bg-brand/10 text-copy"
            : "border-edge/60 text-copy/70 hover:border-copy/30 hover:text-copy",
          focusRing,
        )}
      >
        <span className="truncate">{label}</span>
        <span
          aria-hidden
          className={cn("ml-auto text-xs transition-transform", open && "rotate-180")}
        >
          ▾
        </span>
      </button>

      <div
        id={panelId}
        aria-labelledby={labelId}
        hidden={!open}
        className={cn(
          "absolute right-0 left-0 z-20 rounded-2xl border border-edge/70 bg-raised p-1.5",
          "shadow-lg shadow-shade/40",
          // Down from the strip on a narrow screen, up from the rail's foot
          // on a wide one.
          "top-full mt-2 md:top-auto md:bottom-full md:mt-0 md:mb-2",
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
