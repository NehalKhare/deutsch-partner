"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Check } from "lucide-react";

import type { BillingInterval } from "@dp/domain/billing";
import { buttonPrimary, buttonQuiet, linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { IntervalToggle } from "@/components/pricing/interval-toggle";
import { yearlySavingPercent } from "@/lib/billing/format";
import { PRICING_PATH, type IntervalOffer, type PlanCardView } from "@/lib/billing/offers";

/**
 * The three plans, side by side — on the landing page and on /pricing, from
 * one component, so the two can never describe a plan differently.
 *
 * A Client Component only for the monthly/yearly switch. Everything it shows
 * was decided on the server and arrives as plain data: the prices from the
 * Stripe mirror, the lines from the plan catalogue, and which door each
 * button opens for this visitor. Nothing here knows about Stripe.
 *
 * Every price says VAT is in it, and a yearly price leads with the yearly
 * total, with the month beside it: a month figure on its own would be the
 * cheaper-looking number, and the one a learner does not pay (PAngV). A price
 * that is not in the mirror is said to be missing and has no button — a
 * figure is never invented to fill the card.
 */

export interface PlanCardsProps {
  readonly cards: readonly PlanCardView[];
  /**
   * Where the cards stand. On the landing page a missing price becomes a way
   * to /pricing; on /pricing itself it is said to be missing.
   */
  readonly surface: "landing" | "pricing";
  /** False when the price mirror could not be read at all. */
  readonly catalogueReadable: boolean;
  readonly className?: string;
}

/** The largest saving any plan offers for paying yearly, for the switch's badge. */
function largestSaving(cards: readonly PlanCardView[]): number | null {
  const savings = cards
    .map((card) =>
      card.month.price && card.year.price
        ? yearlySavingPercent(card.month.price.amountMinor, card.year.price.amountMinor)
        : null,
    )
    .filter((saving): saving is number => saving !== null);
  return savings.length > 0 ? Math.max(...savings) : null;
}

function MissingPrice({ surface, readable }: { surface: PlanCardsProps["surface"]; readable: boolean }) {
  if (surface === "landing") {
    return (
      <Link href={PRICING_PATH} className={cn(linkInline, "font-display text-sm")}>
        See pricing
      </Link>
    );
  }
  return (
    <p className="text-sm text-copy/60">
      {readable ? "Prices are being set up." : "Prices could not be loaded just now."}
    </p>
  );
}

function Price({
  offer,
  interval,
  surface,
  readable,
}: {
  offer: IntervalOffer;
  interval: BillingInterval;
  surface: PlanCardsProps["surface"];
  readable: boolean;
}) {
  const price = offer.price;
  if (price === null) return <MissingPrice surface={surface} readable={readable} />;

  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-3xl font-semibold tracking-tight tabular-nums">{price.amount}</span>
        <span className="text-sm text-copy/60">{interval === "year" ? "per year" : "per month"}</span>
      </p>
      <p className="text-xs text-copy/55">
        {price.perMonth ? `${price.perMonth} a month · incl. VAT` : "incl. VAT"}
      </p>
    </div>
  );
}

function PlanCard({
  card,
  interval,
  surface,
  readable,
}: {
  card: PlanCardView;
  interval: BillingInterval;
  surface: PlanCardsProps["surface"];
  readable: boolean;
}) {
  const headingId = useId();
  const offer = interval === "year" ? card.year : card.month;
  const free = card.plan === "free";

  return (
    <li
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border p-5",
        card.recommended ? "border-brand/60 bg-brand/5" : "border-edge/70 bg-panel/50",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="font-display text-lg font-semibold text-brand">
          {card.name}
        </h3>
        {/* Said in words as well as drawn: a border colour alone tells a
            screen reader, and anyone who cannot tell the two apart, nothing. */}
        {card.current ? (
          <span className="rounded-full border border-sprout/50 px-2.5 py-0.5 font-display text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-sprout">
            Your plan
          </span>
        ) : card.recommended ? (
          <span className="rounded-full bg-brand px-2.5 py-0.5 font-display text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-on-accent">
            Recommended
          </span>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-copy/70">{card.tagline}</p>

      {free ? (
        <div className="flex flex-col gap-0.5">
          <p className="font-display text-3xl font-semibold tracking-tight">Free</p>
          <p className="text-xs text-copy/55">No card needed</p>
        </div>
      ) : (
        <Price offer={offer} interval={interval} surface={surface} readable={readable} />
      )}

      <ul className="flex flex-col gap-2 text-sm text-copy/80">
        {card.highlights.map((line) => (
          <li key={line} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sprout" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {/* The buttons sit at the foot of every card, so three cards of
          different lengths still line their buttons up. */}
      <div className="mt-auto flex flex-col gap-2 pt-2">
        {offer.cta ? (
          <Link href={offer.cta.href} className={cn(card.recommended ? buttonPrimary : buttonQuiet, "w-full")}>
            {offer.cta.label}
          </Link>
        ) : null}
        {card.trial ? (
          <p className="flex flex-col items-center gap-0.5 text-center text-sm">
            <Link href={card.trial.href} className={cn(linkInline, "font-display")}>
              {card.trial.label}
            </Link>
            <span className="text-xs text-copy/55">No card, nothing charged</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function PlanCards({ cards, surface, catalogueReadable, className }: PlanCardsProps) {
  const [interval, setBillingInterval] = useState<BillingInterval>("month");

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <IntervalToggle
        value={interval}
        onChange={setBillingInterval}
        yearlySaving={largestSaving(cards)}
        className="self-center"
      />
      {/* Stacked on a phone, three across from lg: side by side is where a
          comparison is read, and a phone has no side. */}
      <ul aria-label="Plans" className="grid gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <PlanCard
            key={card.plan}
            card={card}
            interval={interval}
            surface={surface}
            readable={catalogueReadable}
          />
        ))}
      </ul>
    </div>
  );
}
