import type { Transition } from "framer-motion";

/**
 * How the scenario grid is laid out, and how it moves when that changes.
 *
 * Fifty scenarios are two different jobs. Browsing wants pictures of cards —
 * a description you can read before committing. Hunting for the one you
 * half-remember wants a list you can run your eye down, where fifteen rows
 * fit on a screen instead of eight cards. Neither is the right default for
 * both, so the reader picks.
 *
 * The two shapes are one tree with different classes rather than two
 * components, because Framer Motion can only animate between shapes whose
 * elements survive the change. Remount the subtree and the cards snap.
 */

export const SCENARIO_VIEWS = ["grid", "list"] as const;
export type ScenarioView = (typeof SCENARIO_VIEWS)[number];

/**
 * The one transition every layout animation on this page uses.
 *
 * A spring rather than a duration: the cards are travelling different
 * distances — the first moves a little, the last moves a screen — and a
 * fixed duration makes the far ones look flung and the near ones look stuck.
 */
export const LAYOUT_SPRING: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
};
