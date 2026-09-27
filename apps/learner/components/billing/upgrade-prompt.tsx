"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { buttonQuiet, focusRing, linkInline } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { PRICING_PATH } from "@/lib/billing/offers";
import { reopensLine, type ClockOptions, type PlanRefusal } from "@/lib/billing/refusal";

/** Catch up's route: the name a learner reads changed, the path did not. */
const CATCH_UP_PATH = "/review";

/**
 * What a learner sees when their plan says no (billing-and-plans-spec.md S4).
 *
 * Shown in place of the red alert, because a spent quota is an answer and not
 * a fault: what happened, when it reopens, that nothing they did is lost, and
 * that the practice which costs nothing — Catch up, the curriculum — is open
 * as always. Below the top plan it says where the larger plans are; at the
 * top it sells nothing. The words of the first line are the server's, from a
 * closed set; everything else is said here.
 *
 * Never an alert, and not a live region of its own either: the page renders
 * it inside a polite region that is already there (data-live="plan"), which
 * is what makes a screen reader announce it once, the way the rest of the
 * conversation arrives. A region inserted already holding its text often is
 * not announced at all.
 *
 * Two shapes. The panel stands where the refused turn's alert would have. The
 * note is one quiet line beside a voice control, for a refusal that took
 * nothing away — the device's voice reads on — and it can be put away.
 */
export function UpgradePrompt({
  refusal,
  variant = "panel",
  now,
  clock,
  onDismiss,
  children,
}: {
  readonly refusal: PlanRefusal;
  readonly variant?: "panel" | "note";
  /** For tests; otherwise the moment the prompt appeared. */
  readonly now?: Date;
  readonly clock?: ClockOptions;
  /** Offered only on the note, and only when the caller can keep the dismissal. */
  readonly onDismiss?: () => void;
  /** The note's own sentence, when it says more than the server's message. */
  readonly children?: ReactNode;
}) {
  // When it appeared, not when it re-renders: "back at 09:30" must not
  // quietly become "back in a moment" because a parent redrew.
  const [shownAt] = useState(() => now ?? new Date());
  const reopens = reopensLine(refusal, now ?? shownAt, clock);
  const plans = refusal.upgrade ? (
    <Link href={PRICING_PATH} className={cn(linkInline, "whitespace-nowrap")}>
      See plans
    </Link>
  ) : null;

  if (variant === "note") {
    return (
      <p data-refusal={refusal.error} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1 text-xs text-copy/60">
        <span>{children ?? refusal.message}</span>
        {reopens ? <span>{reopens}</span> : null}
        {plans}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss this note"
            className={cn("rounded-sm text-copy/45 underline-offset-4 hover:text-copy hover:underline", focusRing)}
          >
            Dismiss
          </button>
        ) : null}
      </p>
    );
  }

  return (
    <section
      data-refusal={refusal.error}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1 text-sm leading-relaxed">
        <p className="font-display font-semibold text-copy">{refusal.message}</p>
        <p className="text-copy/70">
          {reopens ? `${reopens} ` : null}Your progress is saved.
        </p>
        <p className="text-xs text-copy/60">
          <Link href={CATCH_UP_PATH} className={linkInline}>
            Catch up
          </Link>{" "}
          and the curriculum stay open on every plan.
        </p>
      </div>
      {refusal.upgrade ? (
        <Link href={PRICING_PATH} className={cn(buttonQuiet, "px-4 py-1.5 text-xs")}>
          See plans
        </Link>
      ) : null}
    </section>
  );
}
