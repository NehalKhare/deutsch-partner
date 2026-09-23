"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lightbulb, MessageSquareText, Radar, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * The operator's five rooms.
 *
 * A client component only because the current page should say so; everything
 * else about it is links. The order is the order of attention: the spend is
 * the front page and the first thing to check, then what learners say about
 * the Trainer, then the learners themselves, then the proposals waiting on a
 * decision, then the scans that feed them.
 *
 * Mobile first, and one tree for both sizes — the learner's nav in the
 * operator's palette. On a phone it is a tab bar pinned under the thumb; from
 * `md` up the same links sit centred in the header as a segmented track. One
 * set of links rather than one per breakpoint keeps a single landmark, a
 * single tab order and a single aria-current.
 */

interface OpsRoom {
  readonly href: string;
  readonly label: string;
  /** What fits under an icon in a fifth of a phone's width. */
  readonly short: string;
  readonly icon: LucideIcon;
}

export const OPS_ROOMS: readonly OpsRoom[] = [
  { href: "/costs", label: "AI spend", short: "Spend", icon: Wallet },
  { href: "/feedback", label: "Trainer feedback", short: "Feedback", icon: MessageSquareText },
  { href: "/learners", label: "Learners", short: "Learners", icon: Users },
  { href: "/product", label: "Feature proposals", short: "Proposals", icon: Lightbulb },
  { href: "/product/runs", label: "Market Scan", short: "Scan", icon: Radar },
];

/**
 * The room the phone tab bar takes up at the foot of the screen.
 *
 * The bar is `fixed`, so the shell puts an in-flow spacer of this height under
 * its scrolling region; the page's own content then ends above the bar rather
 * than scrolling out behind it for good.
 */
export const tabBarSpace = "h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 md:hidden";

/**
 * The longest matching room wins.
 *
 * `/product/runs` sits under `/product`, so a plain prefix test lights two
 * rooms at once; and a proposal at `/product/<id>` has no room of its own, so
 * it should light the board it came from rather than nothing.
 */
export function activeRoom(pathname: string): string | null {
  let best: string | null = null;

  for (const room of OPS_ROOMS) {
    const here = pathname === room.href || pathname.startsWith(`${room.href}/`);
    if (here && (best === null || room.href.length > best.length)) best = room.href;
  }

  return best;
}

export function OpsNav() {
  const active = activeRoom(usePathname());

  return (
    <nav
      aria-label="Operations"
      className={cn(
        // Phone: pinned to the foot, five equal columns, clear of the home
        // indicator. Frosted so a page scrolling under it stays legible.
        "fixed inset-x-0 bottom-0 z-30 border-t border-edge/60 bg-ground/90 px-2 pt-1.5",
        "h-[calc(4rem+env(safe-area-inset-bottom))] pb-[calc(0.375rem+env(safe-area-inset-bottom))]",
        "backdrop-blur-md",
        // Desktop: back into the header as one segmented track.
        "md:static md:z-auto md:h-auto md:rounded-full md:border md:bg-panel/60 md:p-1",
        "md:backdrop-blur-none",
      )}
    >
      <ul className="grid h-full grid-cols-5 gap-1 md:flex md:items-center">
        {OPS_ROOMS.map((room) => {
          const here = active === room.href;
          const Icon = room.icon;

          return (
            <li key={room.href} className="min-w-0">
              <Link
                href={room.href}
                aria-current={here ? "page" : undefined}
                className={cn(
                  // Phone: icon over label, with the tint on a pill behind
                  // the icon. Desktop: icon beside label, tint on the pill.
                  "group flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl",
                  "font-display text-[0.7rem] leading-none whitespace-nowrap transition-colors",
                  "md:flex-row md:gap-2 md:rounded-full md:px-3.5 md:py-2 md:text-sm",
                  here ? "text-brand md:bg-brand/15" : "text-copy/60 hover:text-copy",
                  focusRing,
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    "md:h-auto md:w-auto md:bg-transparent md:group-hover:bg-transparent",
                    here ? "bg-brand/15" : "group-hover:bg-edge/40",
                  )}
                >
                  <Icon className="size-5 md:size-4" strokeWidth={here ? 2.25 : 1.75} aria-hidden />
                </span>
                {/* The short name is for the eye on a phone; the full one is
                    always the link's accessible name. */}
                <span aria-hidden className="md:hidden">
                  {room.short}
                </span>
                <span className="sr-only md:not-sr-only">
                  {/* not-sr-only resets wrapping; the inner span keeps the
                      name on one line. */}
                  <span className="whitespace-nowrap">{room.label}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
