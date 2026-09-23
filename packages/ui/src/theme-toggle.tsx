"use client";

import { useId, useSyncExternalStore } from "react";

import {
  isThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
} from "./theme";
import { setThemePreference, subscribeToTheme, themeStore } from "./theme-store";
import { cn } from "./utils";

/**
 * The theme switch: System, Light, Dark.
 *
 * Real radio inputs in a real fieldset, not buttons wearing `role="radio"`.
 * The browser already gives a radio group arrow-key navigation, a roving tab
 * stop, a grouping a screen reader announces and a label association — and
 * reimplementing those on top of buttons is how a toggle ends up being the one
 * control on the page a keyboard cannot use. The inputs are visually hidden
 * rather than absent, so all of that still applies; `has-checked` and
 * `has-focus-visible` draw the state onto the label.
 *
 * The preference is read through `useSyncExternalStore` rather than held in
 * state. Storage is not React's to own: it is written by the inline head
 * script before React exists and by any other tab at any time. The server
 * snapshot is "system", which is what the server would have rendered anyway,
 * so hydration matches and React corrects it immediately afterwards if the
 * reader has chosen otherwise.
 *
 * System is first and is the default, because it is the answer most readers
 * have already given somewhere else.
 */

/** The server, and the first client render, know only the default. */
const serverSnapshot = (): ThemePreference => "system";

/**
 * One string rather than arguments to `cn`, because tailwind-merge treats
 * `outline` and `outline-2` as the same property and drops the first.
 */
const OPTION =
  "flex-1 cursor-pointer rounded-full px-3 py-1 text-center font-display text-xs " +
  "whitespace-nowrap text-copy/60 transition-colors hover:text-copy " +
  "has-checked:bg-apricot/15 has-checked:text-apricot " +
  "has-focus-visible:outline has-focus-visible:outline-2 " +
  "has-focus-visible:outline-offset-2 has-focus-visible:outline-apricot";

const LABELS: Readonly<Record<ThemePreference, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export interface ThemeToggleProps {
  readonly className?: string;
  /** Hide the "Theme" caption and leave it for screen readers only. */
  readonly hideLegend?: boolean;
}

export function ThemeToggle({ className, hideLegend = false }: ThemeToggleProps) {
  const preference = useSyncExternalStore(
    subscribeToTheme,
    themeStore.read,
    serverSnapshot,
  );
  const name = useId();

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend
        className={cn(
          "mb-1.5 font-display text-xs font-medium uppercase tracking-[0.18em] text-copy/40",
          hideLegend && "sr-only",
        )}
      >
        Theme
      </legend>

      <div className="flex items-center gap-0.5 rounded-full border border-edge/60 bg-panel/60 p-0.5">
        {THEME_PREFERENCES.map((option) => (
          <label key={option} className={OPTION}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={preference === option}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (isThemePreference(next)) setThemePreference(next);
              }}
              className="sr-only"
            />
            {LABELS[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
