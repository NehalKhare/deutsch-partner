/**
 * The visual language, written down once.
 *
 * Every page in the product is the same room: one ground, one warm accent, a
 * tight display face for chrome and a serif for anything a learner reads as a
 * sentence. Keeping the strings here rather than at each call site is what
 * stops the fifth page from being nearly the same as the other four.
 *
 * The colours are named for the role they play — `ground`, `panel`, `edge`,
 * `copy`, `on-accent` — rather than for a material, because the same class
 * string has to work on a near-black page and a near-white one. The two sets
 * of values live in theme.css.
 *
 * These are class strings rather than components on purpose — they compose
 * with whatever a page needs to add, and they cannot grow behaviour.
 */

/** Warm ring on the page's ground; visible without being decoration. */
export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-brand";

/**
 * The ring for anything filled with the accent. The accent ringed in its own
 * colour is a focus ring nobody can see, however correctly it is drawn.
 */
export const focusRingOnAccent =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-on-accent";

/**
 * The one call to action. Filled brand, with whatever reads on top of it in
 * this theme, because the accent is the light source in this palette and the
 * primary action should be it.
 */
export const buttonPrimary =
  "inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 " +
  "font-display font-semibold text-on-accent transition-transform hover:scale-[1.03] " +
  `disabled:pointer-events-none disabled:opacity-55 ${focusRingOnAccent}`;

/** Secondary: the same pill, drawn rather than filled. */
export const buttonQuiet =
  "inline-flex items-center justify-center rounded-full border border-edge " +
  "px-5 py-2 font-display text-sm text-copy/75 transition-colors " +
  "hover:border-brand/60 hover:text-copy disabled:pointer-events-none " +
  `disabled:opacity-55 ${focusRing}`;

/** For a link inside a paragraph, where a pill would be too loud. */
export const linkInline =
  `text-brand underline decoration-brand/40 underline-offset-4 ` +
  `hover:decoration-brand ${focusRing} rounded-sm`;

/** A raised panel on the page's ground. Matches the landing page's proof card. */
export const card = "rounded-2xl border border-edge/70 bg-panel/70 p-5";

/** A small figure with its label: the dashboard and cost grids are made of these. */
export const stat = "rounded-2xl border border-edge/70 bg-panel/70 p-4";

/**
 * The same figure, shrunk to a pill that sits in a page's header.
 *
 * For counts that are context rather than content — how many are waiting,
 * how many are moving. A band of full-size tiles across the top says these
 * are what the page is about, and pushes the thing the page *is* about below
 * the fold. Beside the title they stay legible and stop competing.
 */
export const statPill =
  "inline-flex items-baseline gap-2 rounded-full border border-edge/70 bg-panel/70 px-3 py-1";

/** The label inside a `statPill`. Quieter than the figure, and still readable. */
export const statPillLabel =
  "font-display text-[0.7rem] font-medium uppercase tracking-[0.12em] text-copy/60";

/** The figure inside a `statPill`. */
export const statPillValue =
  "font-display text-sm font-semibold tabular-nums text-copy";

/**
 * A section the reader can fold away.
 *
 * The proposal page carries the whole audit trail — the proposal, its
 * evidence, a PRD, a plan, the scan's findings, the timeline, every decision
 * anybody made — and an operator arriving from the board is there to settle
 * one of them. Left unfolded that is ten screens of scrolling between the
 * question and the answer. Native <details> rather than state, because it
 * folds before React has loaded, it survives the page refreshing itself under
 * a working run, and find-in-page opens what it matched.
 */
export const disclosure = "rounded-2xl border border-edge/70 bg-panel/40";

/**
 * The row that folds it. The whole row is the target, not a chevron at the
 * end of it: a heading you can read but not press is a heading people press
 * anyway and conclude the page is broken.
 */
export const disclosureSummary =
  "flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 " +
  "transition-colors hover:bg-panel/60 [&::-webkit-details-marker]:hidden " +
  focusRing;

/** What the fold reveals, set off from the row that opened it. */
export const disclosureBody =
  "flex flex-col gap-3 border-t border-edge/50 px-4 py-4";

/**
 * A line in a page's outline.
 *
 * Quiet by default and loud only under the pointer, because an outline is
 * furniture until the moment somebody is lost in the page — and a rail of
 * nine links drawn at full contrast competes with the thing it is meant to
 * help you read.
 */
export const outlineLink =
  "flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 font-display text-sm " +
  `text-copy/60 transition-colors hover:bg-panel/60 hover:text-copy ${focusRing}`;

/**
 * The small caps label. Used for anything naming a region rather than saying
 * something — "Week three", "You", "Partner", "Vocabulary".
 */
export const eyebrow =
  "font-display text-xs font-medium uppercase tracking-[0.18em] text-copy/40";

/** Page title. Display face, tight leading, same as the landing hero at rest. */
export const pageTitle =
  "font-display text-3xl font-semibold leading-tight tracking-tight md:text-4xl";

/** Section title, one step down. */
export const sectionTitle =
  "font-display text-lg font-semibold tracking-tight text-copy";

/** Body prose. The serif is the point: this product is about reading sentences. */
export const prose = "leading-relaxed text-copy/70";

/** A text input, select or textarea. */
export const field =
  "w-full rounded-xl border border-edge bg-ground/80 px-3.5 py-2.5 font-body " +
  "text-copy placeholder:text-copy/35 transition-colors hover:border-edge " +
  "focus:border-brand/70 focus:outline-none focus:ring-2 focus:ring-brand/40";

/** The form control accent, so radios and checkboxes are not browser blue. */
export const control = "size-4 shrink-0 accent-brand";

/** A selectable card: radio and checkbox rows in onboarding. */
export const choice =
  "flex cursor-pointer gap-3 rounded-xl border border-edge/70 bg-panel/40 p-3.5 " +
  "transition-colors hover:border-brand/50 has-checked:border-brand " +
  "has-checked:bg-brand/10 has-focus-visible:outline has-focus-visible:outline-2 " +
  "has-focus-visible:outline-offset-2 has-focus-visible:outline-brand";

/** The page container. One width rule so pages line up with each other. */
export const page = "mx-auto flex w-full flex-col gap-8 px-6 py-10 md:px-10 md:py-14";

/** The rule that separates the header, the footer and the major bands. */
export const hairline = "border-edge/60";

/**
 * The gender colours German course books have printed for decades: der blue,
 * die red, das green. Used wherever an article appears, so the association is
 * learned by exposure rather than taught — which is the only way it is ever
 * learned. Here rather than on one page, because the second page to show a
 * word must colour it the same or the exposure teaches nothing.
 */
export const ARTICLE_COLOR: Readonly<Record<string, string>> = {
  der: "text-der",
  die: "text-die",
  das: "text-das",
};
