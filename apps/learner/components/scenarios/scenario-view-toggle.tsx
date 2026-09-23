"use client";

import { LayoutGrid, List } from "lucide-react";
import { motion } from "framer-motion";

import { LAYOUT_SPRING, type ScenarioView } from "@/components/scenarios/view";
import { focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

/**
 * The grid / list switch that sits beside the type filter.
 *
 * Two icon buttons sharing one highlight. The highlight is a single element
 * with a `layoutId`, so Framer Motion removes it from under one button and
 * mounts it under the other and — recognising the shared id — slides it
 * across instead of blinking. That is the whole trick, and it is why the pill
 * is drawn behind the icon rather than on the button itself.
 *
 * `aria-pressed` toggle buttons rather than a radio group, matching the type
 * pills next to them: two controls a finger's width apart that announce
 * themselves differently are two controls a screen reader user has to learn
 * twice. Each carries a text label, because an icon has no accessible name
 * and "button" is not one.
 */

const OPTIONS: ReadonlyArray<{
  readonly value: ScenarioView;
  readonly label: string;
  readonly Icon: typeof LayoutGrid;
}> = [
  { value: "grid", label: "Grid view", Icon: LayoutGrid },
  { value: "list", label: "List view", Icon: List },
];

export function ScenarioViewToggle({
  view,
  onChange,
}: {
  view: ScenarioView;
  onChange: (view: ScenarioView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="flex items-center gap-0.5 rounded-full border border-edge/70 bg-panel/50 p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={cn(
              "relative grid size-8 place-items-center rounded-full transition-colors",
              active ? "text-brand" : "text-copy/50 hover:text-copy",
              focusRing,
            )}
          >
            {active && (
              <motion.span
                layoutId="scenario-view-indicator"
                transition={LAYOUT_SPRING}
                className="absolute inset-0 rounded-full bg-brand/15"
                aria-hidden
              />
            )}
            <Icon aria-hidden className="relative size-4" strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
