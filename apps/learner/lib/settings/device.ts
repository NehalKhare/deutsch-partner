import { useSyncExternalStore } from "react";

/**
 * Preferences that live on the device rather than in the profile.
 *
 * Not everything a learner chooses is a fact about the learner. Whether the
 * mastery strip is in view, and which voice reads replies aloud, are answers
 * that can differ per machine — the built-in speech voices on a phone and a
 * desktop are different products — so they are kept in localStorage and never
 * cost a server round trip to change.
 *
 * Read through useSyncExternalStore rather than an effect: the server render
 * has no storage and says the fallback, and this is the one hook that lets
 * the client disagree with that without a hydration error or a cascading
 * render. Writes notify subscribers directly (same tab) and other tabs hear
 * the storage event for free.
 */

export interface DevicePreference<T extends string> {
  readonly fallback: T;
  readonly read: () => T;
  readonly write: (value: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createDevicePreference<T extends string>(
  key: string,
  values: readonly T[],
  fallback: T,
): DevicePreference<T> {
  const listeners = new Set<() => void>();
  // Carries the choice for a visit whose storage refuses to (private mode,
  // blocked site data): the toggle still works, it just forgets on reload.
  let sessionValue: T | null = null;

  const isValue = (raw: string): raw is T =>
    (values as readonly string[]).includes(raw);

  return {
    fallback,
    read() {
      try {
        const raw = window.localStorage.getItem(key);
        // Stored garbage is treated as nothing: a preference that cannot be
        // understood must not be able to wedge a page.
        return raw !== null && isValue(raw) ? raw : fallback;
      } catch {
        return sessionValue ?? fallback;
      }
    },
    write(value) {
      sessionValue = value;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // The session value above still makes the choice real for this visit.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
  };
}

export function useDevicePreference<T extends string>(
  preference: DevicePreference<T>,
): T {
  return useSyncExternalStore(preference.subscribe, preference.read, () => preference.fallback);
}

/** Whether the chat's mastery strip is in view. */
export const masteryStripStore = createDevicePreference(
  "deutsch-partner.mastery-strip",
  ["shown", "hidden"] as const,
  "shown",
);

/**
 * Which voice reads replies aloud.
 *
 * "ai" is the speech model — it sounds like a person, costs money per line,
 * and needs the server; the device's own voice remains its fallback. "browser"
 * is the Web Speech API alone: instant, free, and offline, at whatever quality
 * this device ships.
 */
export const VOICE_ENGINES = ["ai", "browser"] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];

export const voiceEngineStore = createDevicePreference<VoiceEngine>(
  "deutsch-partner.voice-engine",
  VOICE_ENGINES,
  "ai",
);
