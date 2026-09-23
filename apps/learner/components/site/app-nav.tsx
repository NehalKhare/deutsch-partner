"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Drama, LayoutDashboard, MessagesSquare, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * The signed-in navigation.
 *
 * Five rooms in three groups, because they are three kinds of thing. Dashboard
 * and Curriculum are where you look at the path; Chat and Scenarios are where
 * somebody answers, and they sit inside one capsule so that reads at a glance
 * rather than having to be worked out from a flat row; Catch up is where you
 * fix what is going wrong, and it is the only item that ever colours itself.
 *
 * Mobile first, and one tree for both sizes. On a phone the bar is a tab bar
 * pinned under the thumb — five rooms fit five columns, and a hamburger would
 * hide the one item whose whole job is to be noticed. From `md` up the same
 * links sit centred in the header as a segmented track. Rendering the links
 * once rather than twice (one list per breakpoint) keeps a single set of
 * landmarks, a single tab order and a single aria-current for a screen reader.
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

interface Room {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const ROOMS: readonly Room[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/curriculum", label: "Curriculum", icon: BookOpen },
];

/** The two rooms with somebody in them. */
const TALK: readonly Room[] = [
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/scenarios", label: "Scenarios", icon: Drama },
];

/**
 * The route stays /review; only the name a learner reads has changed.
 *
 * "Review" was the clinical word for it. What the page holds is the words
 * going stale and the mistakes that keep coming back, and catching up is what
 * you do about them. Changing the URL as well would break bookmarks and touch
 * four more files to nobody's benefit.
 */
const CATCH_UP: Room = { href: "/review", label: "Catch up", icon: RotateCcw };

/**
 * The room the phone tab bar takes up at the foot of the screen.
 *
 * The bar is `fixed`, so it takes no space of its own; the shell puts an
 * in-flow spacer of this height under its scrolling region instead. A spacer
 * rather than padding on the scroller, because the composers in Chat and the
 * Trainer are `sticky bottom-0` inside it and have to come to rest above the
 * bar, not behind it.
 */
export const tabBarSpace = "h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 md:hidden";

/**
 * One link, two shapes.
 *
 * Phone: icon over label, a full-height column of the tab bar, with the
 * active tint on a pill behind the icon (the Material 3 indicator — a tinted
 * column the width of a thumb reads as a pressed button). Desktop: icon beside
 * label in a pill, with the tint on the whole pill.
 */
const LINK =
  "group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl " +
  "font-display text-[0.7rem] leading-none whitespace-nowrap transition-colors " +
  "md:flex-row md:gap-2 md:rounded-full md:px-3.5 md:py-2 md:text-sm";

const INDICATOR =
  "flex h-7 w-12 items-center justify-center rounded-full transition-colors " +
  "md:h-auto md:w-auto md:bg-transparent";

/** A thread under /chat/[id] is still Chat: the room, not the page. */
const isHere = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

function NavLink({
  room,
  active,
  className,
  indicator,
  badge,
  ...rest
}: {
  readonly room: Room;
  readonly active: boolean;
  readonly className?: string;
  /** The phone indicator's colours; brand unless the link says otherwise. */
  readonly indicator?: string;
  readonly badge?: React.ReactNode;
} & Pick<React.ComponentProps<typeof Link>, "aria-label">) {
  const Icon = room.icon;

  return (
    <Link
      href={room.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        LINK,
        active ? "text-brand md:bg-brand/15" : "text-copy/60 hover:text-copy",
        focusRing,
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          INDICATOR,
          indicator ?? (active ? "bg-brand/15" : "group-hover:bg-edge/40"),
        )}
      >
        <Icon className="size-5 md:size-4" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
      </span>
      {room.label}
      {badge}
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
    <nav
      aria-label="Main"
      className={cn(
        // Phone: pinned to the foot, five equal columns, clear of the home
        // indicator. Frosted so a page scrolling under it stays legible.
        "fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 gap-1 border-t border-edge/60",
        "h-[calc(4rem+env(safe-area-inset-bottom))] bg-ground/90 px-2 pt-1.5",
        "pb-[calc(0.375rem+env(safe-area-inset-bottom))] backdrop-blur-md",
        // Desktop: back into the header as one segmented track.
        "md:static md:z-auto md:flex md:h-auto md:items-center md:gap-1 md:rounded-full",
        "md:border md:bg-panel/60 md:p-1 md:backdrop-blur-none",
      )}
    >
      {ROOMS.map((room) => (
        <NavLink key={room.href} room={room} active={isHere(pathname, room.href)} />
      ))}

      {/* One capsule, so the two rooms where somebody answers read as a pair
          rather than as two more entries in a row of five. Labelled as a group
          so the grouping reaches a screen reader too, not only the eye. On a
          phone it is a shared tint behind two tab columns; on desktop a
          segment set off by hairlines inside the track. */}
      <span
        role="group"
        aria-label="Talk with your tutor"
        className={cn(
          "col-span-2 grid grid-cols-2 gap-1 rounded-2xl bg-panel/70",
          "md:flex md:items-center md:rounded-none md:border-x md:border-edge/60",
          "md:bg-transparent md:px-1",
        )}
      >
        {TALK.map((room) => (
          <NavLink key={room.href} room={room} active={isHere(pathname, room.href)} />
        ))}
      </span>

      {/* Always bold — it is where the work is. Ember only when something is
          actually overdue: this is the product's error colour, and a nav item
          permanently wearing it is a fault light nobody looks at. */}
      <NavLink
        room={CATCH_UP}
        active={onCatchUp}
        aria-label={waiting ? `${CATCH_UP.label}, ${dueCount} due` : undefined}
        className={cn(
          "font-semibold",
          waiting &&
            (onCatchUp
              ? "text-ember md:bg-ember/15"
              : "text-ember hover:text-ember"),
        )}
        indicator={waiting ? (onCatchUp ? "bg-ember/15" : undefined) : undefined}
        badge={
          waiting ? (
            // Hidden from the accessibility tree: the link's own label says
            // "3 due", where a bare "Catch up 3" read aloud says nothing.
            // On a phone it rides the icon's corner; on desktop it follows
            // the label.
            <span
              aria-hidden
              data-role="due-count"
              className={cn(
                "absolute top-0 left-1/2 ml-2 min-w-[1.25rem] rounded-full bg-ember px-1 py-0.5",
                "text-center text-[0.65rem] leading-none font-semibold text-on-accent tabular-nums",
                "ring-2 ring-ground",
                "md:static md:ml-0 md:bg-ember/20 md:px-1.5 md:text-xs md:text-ember md:ring-0",
              )}
            >
              {dueCount > 99 ? "99+" : dueCount}
            </span>
          ) : null
        }
      />
    </nav>
  );
}
