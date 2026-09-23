"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * The four pages of the spend room.
 *
 * A second row under the operator nav rather than four more rooms in it: the
 * phone tab bar is already full, and budgets, prices and the
 * ledger are all ways of answering the spend page's question. `/costs` stays
 * the room, so "AI spend" stays lit on every one of them.
 *
 * A client component only for aria-current. Scrolls sideways on a phone
 * rather than wrapping, so the row keeps one height.
 */

export const COST_TABS = [
  { href: "/costs", label: "Spend" },
  { href: "/costs/budgets", label: "Budgets" },
  { href: "/costs/pricing", label: "Pricing" },
  { href: "/costs/invocations", label: "Ledger" },
] as const;

/** Exact for the spend page, prefix for the rest, so a call's detail lights Ledger. */
export function activeCostTab(pathname: string): string | null {
  if (pathname === "/costs") return "/costs";

  const match = COST_TABS.find(
    (tab) => tab.href !== "/costs" && (pathname === tab.href || pathname.startsWith(`${tab.href}/`)),
  );
  return match?.href ?? null;
}

export function CostsTabs() {
  const active = activeCostTab(usePathname());

  return (
    <nav aria-label="Spend" className="-mx-1 overflow-x-auto">
      <ul className="flex w-max gap-1 p-1">
        {COST_TABS.map((tab) => {
          const here = active === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "block rounded-full px-3.5 py-1.5 font-display text-sm whitespace-nowrap transition-colors",
                  here ? "bg-brand/15 text-brand" : "text-copy/60 hover:bg-panel/60 hover:text-copy",
                  focusRing,
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
