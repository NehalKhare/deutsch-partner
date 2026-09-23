"use client";

import { useActionState } from "react";

import { buttonPrimary, focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import {
  INITIAL_SWITCH_LEVEL_STATE,
  type SwitchLevelAction,
} from "@/lib/curriculum/switch-level";

/**
 * Moving to the level being looked at.
 *
 * Deliberately not the same control as the tabs above it. Browsing a level and
 * being taught at it are different things, and a learner who clicks "A2" to
 * see what is coming should not find their syllabus has moved under them.
 * Looking is free; moving is a button that says what it will do.
 */
export function SwitchLevel({
  level,
  miniLevel,
  theme,
  action,
}: {
  readonly level: string;
  /** Where they would land, which is the part worth saying out loud. */
  readonly miniLevel: number;
  readonly theme: string;
  readonly action: SwitchLevelAction;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_SWITCH_LEVEL_STATE,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="level" value={level} />
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonPrimary, "px-5 py-2.5 text-sm", focusRing)}
        >
          {pending ? "Moving…" : `Learn ${level} instead`}
        </button>
        <span className="text-xs text-copy/60">
          Picks up at mini-level {miniLevel}, {theme}
        </span>
      </form>

      <p role="status" aria-live="polite" className="text-xs text-ember empty:sr-only">
        {state.message}
      </p>
    </div>
  );
}
