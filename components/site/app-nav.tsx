"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

/**
 * The signed-in navigation.
 *
 * Five rooms in three groups, because they are three kinds of thing. Dashboard
 * and Curriculum are where you look at the path; Chat and Scenarios are where
 * somebody answers, and they sit inside one capsule so that reads at a glance
 * rather than having to be worked out from a flat row; Catch up is where you
 * fix what is going wrong, and it is the only item that ever colours itself.
 *
 * A client component only because the current page should say so — everything
 * else about it is links.
 *
 * Chat is deliberately the entry point rather than a thread: threads are
 * places to practise, and which one is today's is a choice, not a route.
 *
 * The Trainer is not here, and that is the grouping argument one step further:
 * it is not a place to go, it is what you do about what Catch up found. It is
 * reached from there, where the reason to open it is on the screen.
 *
 * Settings is not here, and neither is the spend dashboard. Neither is a room
 * to practise in; both are about the account, and they live in the menu on the
 * right with the way out.
 */
const ROOMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/curriculum", label: "Curriculum" },
] as const;

/** The two rooms with somebody in them. */
const TALK = [
  { href: "/chat", label: "Chat" },
  { href: "/scenarios", label: "Scenarios" },
] as const;

/**
 * The route stays /review; only the name a learner reads has changed.
 *
 * "Review" was the clinical word for it. What the page holds is the words
 * going stale and the mistakes that keep coming back, and catching up is what
 * you do about them. Changing the URL as well would break bookmarks and touch
 * four more files to nobody's benefit.
 */
const CATCH_UP = { href: "/review", label: "Catch up" } as const;

const PILL =
  "rounded-full px-3 py-1.5 font-display text-sm whitespace-nowrap transition-colors";

/** A thread under /chat/[id] is still Chat: the room, not the page. */
const isHere = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

function NavLink({
  href,
  label,
  active,
  className,
  children,
  ...rest
}: {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
  readonly className?: string;
  readonly children?: React.ReactNode;
} & Pick<React.ComponentProps<typeof Link>, "aria-label">) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        PILL,
        active ? "bg-apricot/15 text-apricot" : "text-chalk/55 hover:text-chalk",
        focusRing,
        className,
      )}
      {...rest}
    >
      {label}
      {children}
    </Link>
  );
}

export interface AppNavProps {
  /**
   * Words past their review date. Drives the one bit of colour in the bar.
   *
   * Overdue rather than the wider "things to go over", because this is the
   * count the Catch up page itself prints under Overdue — a badge that
   * disagreed with the page it points at would be worse than no badge.
   */
  readonly dueCount?: number;
}

export function AppNav({ dueCount = 0 }: AppNavProps) {
  const pathname = usePathname();
  const waiting = dueCount > 0;
  const onCatchUp = isHere(pathname, CATCH_UP.href);

  return (
    <nav aria-label="Main" className="-m-1 flex items-center gap-1 overflow-x-auto p-1">
      {ROOMS.map((room) => (
        <NavLink
          key={room.href}
          href={room.href}
          label={room.label}
          active={isHere(pathname, room.href)}
        />
      ))}

      {/* One capsule, so the two rooms where somebody answers read as a pair
          rather than as two more entries in a row of five. Labelled as a group
          so the grouping reaches a screen reader too, not only the eye. */}
      <span
        role="group"
        aria-label="Talk with your tutor"
        className="flex items-center gap-1 rounded-full border border-haze/60 bg-dusk/60 p-0.5"
      >
        {TALK.map((room) => (
          <NavLink
            key={room.href}
            href={room.href}
            label={room.label}
            active={isHere(pathname, room.href)}
          />
        ))}
      </span>

      {/* Always bold — it is where the work is. Ember only when something is
          actually overdue: this is the product's error colour, and a nav item
          permanently wearing it is a fault light nobody looks at. */}
      <NavLink
        href={CATCH_UP.href}
        label={CATCH_UP.label}
        active={onCatchUp}
        aria-label={waiting ? `${CATCH_UP.label}, ${dueCount} due` : undefined}
        className={cn(
          "font-semibold",
          waiting &&
            (onCatchUp ? "bg-ember/15 text-ember" : "text-ember hover:text-ember"),
        )}
      >
        {waiting ? (
          // Hidden from the accessibility tree: the link's own label says
          // "3 due", where a bare "Catch up 3" read aloud says nothing.
          <span
            aria-hidden
            data-role="due-count"
            className="ml-1.5 rounded-full bg-ember/20 px-1.5 py-0.5 text-xs tabular-nums"
          >
            {dueCount}
          </span>
        ) : null}
      </NavLink>
    </nav>
  );
}
