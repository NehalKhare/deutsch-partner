/**
 * Everything this product keeps in a visitor's browser.
 *
 * The privacy policy prints this table, and a test holds it to the code:
 * every `deutsch-partner.*` key the learner app writes must be described
 * here, so a preference added next month cannot go unmentioned. None of it
 * needs consent under §25(2) TDDDG — each item is strictly necessary for a
 * service the visitor asked for — which is why the product has no cookie
 * banner, and why adding anything that would need one is a deliberate act
 * rather than an oversight (packages/security-tests, third-party-scripts).
 */

export interface StorageItem {
  /** The exact key, or a pattern for one set by a library. */
  readonly key: string;
  readonly kind: "cookie" | "localStorage" | "sessionStorage";
  /** Who sets it. "Deutsch Partner" or the library's name. */
  readonly setBy: string;
  readonly purpose: string;
  readonly lifetime: string;
}

export const STORAGE_ITEMS: readonly StorageItem[] = [
  {
    key: "sb-<project>-auth-token",
    kind: "cookie",
    setBy: "Supabase Auth",
    purpose: "Keeps you signed in. Holds your session token and nothing about what you practised.",
    lifetime: "Until you sign out, or the session expires",
  },
  {
    key: "deutsch-partner.theme",
    kind: "localStorage",
    setBy: "Deutsch Partner",
    purpose: "Whether you chose the light or dark look, or left it to your system.",
    lifetime: "Until you clear it",
  },
  {
    key: "deutsch-partner.mastery-strip",
    kind: "localStorage",
    setBy: "Deutsch Partner",
    purpose: "Whether the vocabulary strip in the conversation is shown or hidden on this device.",
    lifetime: "Until you clear it",
  },
  {
    key: "deutsch-partner.voice-engine",
    kind: "localStorage",
    setBy: "Deutsch Partner",
    purpose: "Which voice reads replies aloud on this device: the AI voice or the device's own.",
    lifetime: "Until you clear it",
  },
  {
    key: "deutsch-partner.voice-plan-note",
    kind: "localStorage",
    setBy: "Deutsch Partner",
    purpose: "Whether you dismissed the note about the AI voice on this device.",
    lifetime: "Until you clear it",
  },
];

/** The keys the test compares against the code. */
export const STORAGE_KEYS: readonly string[] = STORAGE_ITEMS.map((item) => item.key);
