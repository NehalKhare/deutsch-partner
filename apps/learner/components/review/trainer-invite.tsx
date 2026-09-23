import Link from "next/link";

import { focusRingOnAccent } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import styles from "./trainer-invite.module.css";

/**
 * The way into the Trainer, from the page that knows what needs doing.
 *
 * Catch up lists what is due; it cannot ask you anything. The Trainer builds a
 * session from that same plan and works through it — asking, marking the
 * answer, recording the outcome. So this is not a link to a sibling feature,
 * it is the start button this page never had.
 *
 * It sits beside the page's title and is the only lit thing on the screen,
 * because the fact it announces is one a learner will otherwise never learn:
 * that they have a personal trainer at all. Since the Trainer left the
 * navigation, this is the only place that says so.
 *
 * It says nothing about how much is due. The heading it sits next to already
 * counts that, and a button that promises a queue is a button that has to stop
 * making sense the moment the queue empties — while the trainer is worth
 * opening either way.
 */

export function TrainerInvite() {
  return (
    <Link
      href="/trainer"
      className={cn(
        styles.invite,
        "group flex w-full items-center gap-3 rounded-2xl px-4 py-3 sm:w-auto",
        // The on-accent ring, not the accent itself: an accent-coloured ring
        // inside this much accent light is drawn correctly and cannot be seen.
        focusRingOnAccent,
      )}
    >
      <span className="flex flex-col text-left">
        <span className="font-display text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-on-accent/80">
          Your personal trainer
        </span>
        <span className="font-display text-[0.95rem] leading-tight font-semibold text-on-accent">
          Perfect your mistakes
        </span>
      </span>
      <span
        aria-hidden
        className="ml-auto font-display text-on-accent/70 transition-transform group-hover:translate-x-0.5 sm:ml-0"
      >
        →
      </span>
    </Link>
  );
}
