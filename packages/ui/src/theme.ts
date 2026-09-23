/**
 * Which of the two themes the product is wearing.
 *
 * Three states, not two. "System" is a real choice and the default one: a
 * reader who has told their OS they want light at 3pm and dark at 9pm has
 * already answered this question, and a product that makes them answer it
 * again — and then ignores the schedule — is worse than one with no toggle.
 *
 * Nothing here touches `window`, `react` or the store: the inline head script
 * is a Server Component and needs the key and the attribute from this file.
 * Reading and writing the preference lives in theme-store.ts.
 *
 * The CSS in theme.css resolves "system" on its own through a media query, so
 * the attribute this module writes is *absent* for the default. That is why
 * there is no third attribute value: an unset `data-theme` means "whatever the
 * OS says", and it means it whether or not this JavaScript ever ran.
 */

export const THEME_STORAGE_KEY = "deutsch-partner.theme";

/** The attribute theme.css reads. Absent means "follow the OS". */
export const THEME_ATTRIBUTE = "data-theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** A resolved theme: what is actually on screen once "system" is answered. */
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * Puts the preference on the document. "System" removes the attribute rather
 * than writing a value, which is what hands the decision back to the media
 * query in theme.css.
 */
export function applyPreference(
  root: Pick<HTMLElement, "setAttribute" | "removeAttribute">,
  preference: ThemePreference,
): void {
  if (preference === "system") root.removeAttribute(THEME_ATTRIBUTE);
  else root.setAttribute(THEME_ATTRIBUTE, preference);
}

/** What is actually on screen, given the preference and what the OS asks for. */
export function resolveTheme(
  preference: ThemePreference,
  prefersLight: boolean,
): ResolvedTheme {
  if (preference !== "system") return preference;
  return prefersLight ? "light" : "dark";
}

/** Whether the OS is asking for light. False anywhere `matchMedia` is missing. */
export function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}
