"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

/**
 * The signed-in navigation.
 *
 * Six rooms, named for what a learner does in them. A client component only
 * because the current page should say so — everything else about it is links.
 *
 * Chat is deliberately the entry point rather than a thread: threads are
 * places to practise, and which one is today's is a choice, not a route.
 *
 * The Trainer is not here either, and that is the same argument one step
 * further: it is not a place to go, it is what you do about what Review found.
 * It is reached from Review, where the reason to open it is on the screen.
 *
 * Settings is not here, and neither is the spend dashboard. Neither is a room
 * to practise in; both are about the account, and they live in the menu on the
 * right with the way out.
 */
const DESTINATIONS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/curriculum", label: "Curriculum" },
  { href: "/review", label: "Review" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="-m-1 flex items-center gap-1 overflow-x-auto p-1">
      {DESTINATIONS.map((destination) => {
        const active =
          pathname === destination.href ||
          pathname.startsWith(`${destination.href}/`);

        return (
          <Link
            key={destination.href}
            href={destination.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 font-display text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-apricot/15 text-apricot"
                : "text-chalk/55 hover:text-chalk",
              focusRing,
            )}
          >
            {destination.label}
          </Link>
        );
      })}
    </nav>
  );
}
