import { createDevicePreference } from "./device-preference";
import {
  applyPreference,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme";

/**
 * The theme, as something that can be read and written.
 *
 * Split from theme.ts because the inline head script is a Server Component and
 * imports the key and the attribute from there. Everything in this file
 * reaches `window`, and pulling `useSyncExternalStore` into a server module —
 * which importing the device-preference primitive does — fails the build.
 *
 * A device preference like the voice and the mastery strip, and built on the
 * same primitive: which machine you are at is exactly the sort of thing that
 * decides this, and none of it belongs in the profile.
 */

export const themeStore = createDevicePreference<ThemePreference>(
  THEME_STORAGE_KEY,
  THEME_PREFERENCES,
  "system",
);

/** Chooses a theme: stores it, and puts it on this document straight away. */
export function setThemePreference(preference: ThemePreference): void {
  themeStore.write(preference);
  if (typeof document !== "undefined") {
    applyPreference(document.documentElement, preference);
  }
}

/**
 * Subscribes for `useSyncExternalStore`, applying every change to the document
 * on the way past.
 *
 * The store's own subscription already covers both directions — its `write`
 * notifies this tab, and the `storage` event covers the others — but neither
 * touches the DOM. Doing it here rather than in a component keeps the page and
 * storage in step for as long as anything is watching.
 */
export function subscribeToTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  return themeStore.subscribe(() => {
    if (typeof document !== "undefined") {
      applyPreference(document.documentElement, themeStore.read());
    }
    onChange();
  });
}
