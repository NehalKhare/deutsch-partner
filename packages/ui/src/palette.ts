/**
 * The learner palette's values, for the few surfaces that cannot read CSS.
 *
 * Everything on a page takes its colour from theme.css through a role token,
 * and no component ever states a hex. Two things are not on a page: the web
 * app manifest, which a browser parses as JSON before any stylesheet loads,
 * and the Open Graph card, which a server renders to a PNG with no stylesheet
 * at all. Both need the values the CSS has, and a value copied by hand drifts
 * the first time someone retunes the theme. So they are stated here once, and
 * a test in packages/ui holds every entry equal to its literal in theme.css.
 *
 * Learner values only. The operator app is never shared and never indexed, so
 * it has no card to draw and no manifest to fill.
 */
export const LEARNER_PALETTE = {
  dark: {
    ground: "#0f1320",
    panel: "#171c2e",
    edge: "#2b3350",
    copy: "#ede7dc",
    brand: "#f2a277",
    onAccent: "#0f1320",
  },
  light: {
    ground: "#faf6ef",
    panel: "#efe7d9",
    edge: "#d6cbb8",
    copy: "#12172a",
    brand: "#9e4713",
    onAccent: "#fffaf3",
  },
} as const;

export type PaletteRole = keyof (typeof LEARNER_PALETTE)["dark"];
