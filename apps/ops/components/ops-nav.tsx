"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * The operator's four rooms, down the rail.
 *
 * A client component only because the current page should say so; everything
 * else about it is links. The order is the order of the work: a scan finds
 * something, it becomes a proposal you decide on, learners tell you whether
 * the thing you shipped is any good, and the spend is what it all cost.
 */

export const OPS_ROOMS = [
  { href: "/product", label: "Feature proposals" },
  { href: "/product/runs", label: "Market Scan" },
  { href: "/feedback", label: "Trainer feedback" },
  { href: "/costs", label: "AI spend" },
] as const;

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
    <nav aria-label="Operations" className="-mx-1 min-w-0">
      <ul className="flex gap-1 overflow-x-auto px-1 md:flex-col md:overflow-x-visible">
        {OPS_ROOMS.map((room) => (
          <li key={room.href} className="shrink-0 md:shrink">
            <Link
              href={room.href}
              aria-current={active === room.href ? "page" : undefined}
              className={cn(
                "block rounded-lg px-3 py-2 font-display text-sm whitespace-nowrap transition-colors",
                active === room.href
                  ? "bg-brand/15 text-brand"
                  : "text-copy/70 hover:bg-panel/60 hover:text-copy",
                focusRing,
              )}
            >
              {room.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
