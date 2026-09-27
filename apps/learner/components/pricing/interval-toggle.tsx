"use client";

import { useId } from "react";

import type { BillingInterval } from "@dp/domain/billing";
import { cn } from "@dp/ui/utils";

/**
 * Monthly or yearly.
 *
 * Real radios in a real fieldset, as the theme switch is and for the same
 * reasons: the browser already gives a radio group arrow keys, one tab stop
 * and a grouping a screen reader announces. The inputs are visually hidden,
 * not absent, and `has-checked` draws the choice onto its label.
 *
 * Monthly comes first and is the default. The smaller commitment is the
 * honest place to start, and the saving is stated beside the other option
 * rather than preselected into the basket.
 */

/**
 * One string rather than arguments to `cn`, because tailwind-merge treats
 * `outline` and `outline-2` as the same property and drops the first.
 */
const OPTION =
  "flex cursor-pointer items-center gap-2 rounded-full px-4 py-1.5 font-display text-sm " +
  "whitespace-nowrap text-copy/65 transition-colors hover:text-copy " +
  "has-checked:bg-brand/15 has-checked:text-brand " +
  "has-focus-visible:outline has-focus-visible:outline-2 " +
  "has-focus-visible:outline-offset-2 has-focus-visible:outline-brand";

const LABELS: Readonly<Record<BillingInterval, string>> = {
  month: "Monthly",
  year: "Yearly",
};

export interface IntervalToggleProps {
  readonly value: BillingInterval;
  readonly onChange: (interval: BillingInterval) => void;
  /** The largest whole percent a yearly price saves, or null to say nothing. */
  readonly yearlySaving: number | null;
  readonly className?: string;
}

export function IntervalToggle({ value, onChange, yearlySaving, className }: IntervalToggleProps) {
  const name = useId();

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="sr-only">How often to pay</legend>
      <div className="inline-flex items-center gap-0.5 rounded-full border border-edge/60 bg-panel/60 p-0.5">
        {(["month", "year"] as const).map((option) => (
          <label key={option} className={OPTION}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {LABELS[option]}
            {option === "year" && yearlySaving !== null ? (
              <span className="rounded-full bg-sprout/15 px-2 py-0.5 text-[0.7rem] font-semibold text-sprout">
                save up to {yearlySaving}%
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
