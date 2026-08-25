/**
 * The visual language, written down once.
 *
 * Every page in the product is the same room: deep blue ground, warm accent,
 * a tight display face for chrome and a serif for anything a learner reads as
 * a sentence. Keeping the strings here rather than at each call site is what
 * stops the fifth page from being nearly the same as the other four.
 *
 * These are class strings rather than components on purpose — they compose
 * with whatever a page needs to add, and they cannot grow behaviour.
 */

/** Warm ring on the dark ground; visible without being decoration. */
export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-apricot";

/**
 * The ring for anything filled with the accent. Apricot on apricot is a focus
 * ring nobody can see, however correctly it is drawn.
 */
export const focusRingOnAccent =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-chalk";

/**
 * The one call to action. Filled apricot with ink text, because the accent is
 * the light source in this palette and the primary action should be it.
 */
export const buttonPrimary =
  "inline-flex items-center justify-center rounded-full bg-apricot px-6 py-3 " +
  "font-display font-semibold text-ink transition-transform hover:scale-[1.03] " +
  `disabled:pointer-events-none disabled:opacity-55 ${focusRingOnAccent}`;

/** Secondary: the same pill, drawn rather than filled. */
export const buttonQuiet =
  "inline-flex items-center justify-center rounded-full border border-haze " +
  "px-5 py-2 font-display text-sm text-chalk/75 transition-colors " +
  "hover:border-apricot/60 hover:text-chalk disabled:pointer-events-none " +
  `disabled:opacity-55 ${focusRing}`;

/** For a link inside a paragraph, where a pill would be too loud. */
export const linkInline =
  `text-apricot underline decoration-apricot/40 underline-offset-4 ` +
  `hover:decoration-apricot ${focusRing} rounded-sm`;

/** A raised panel on the ink ground. Matches the landing page's proof card. */
export const card = "rounded-2xl border border-haze/70 bg-dusk/70 p-5";

/** A small figure with its label: the dashboard and cost grids are made of these. */
export const stat = "rounded-2xl border border-haze/70 bg-dusk/70 p-4";

/**
 * The small caps label. Used for anything naming a region rather than saying
 * something — "Week three", "You", "Partner", "Vocabulary".
 */
export const eyebrow =
  "font-display text-xs font-medium uppercase tracking-[0.18em] text-chalk/40";

/** Page title. Display face, tight leading, same as the landing hero at rest. */
export const pageTitle =
  "font-display text-3xl font-semibold leading-tight tracking-tight md:text-4xl";

/** Section title, one step down. */
export const sectionTitle =
  "font-display text-lg font-semibold tracking-tight text-chalk";

/** Body prose. The serif is the point: this product is about reading sentences. */
export const prose = "leading-relaxed text-chalk/70";

/** A text input, select or textarea. */
export const field =
  "w-full rounded-xl border border-haze bg-ink/80 px-3.5 py-2.5 font-body " +
  "text-chalk placeholder:text-chalk/35 transition-colors hover:border-haze " +
  "focus:border-apricot/70 focus:outline-none focus:ring-2 focus:ring-apricot/40";

/** The form control accent, so radios and checkboxes are not browser blue. */
export const control = "size-4 shrink-0 accent-apricot";

/** A selectable card: radio and checkbox rows in onboarding. */
export const choice =
  "flex cursor-pointer gap-3 rounded-xl border border-haze/70 bg-dusk/40 p-3.5 " +
  "transition-colors hover:border-apricot/50 has-checked:border-apricot " +
  "has-checked:bg-apricot/10 has-focus-visible:outline has-focus-visible:outline-2 " +
  "has-focus-visible:outline-offset-2 has-focus-visible:outline-apricot";

/** The page container. One width rule so pages line up with each other. */
export const page = "mx-auto flex w-full flex-col gap-8 px-6 py-10 md:px-10 md:py-14";

/** The rule that separates the header, the footer and the major bands. */
export const hairline = "border-haze/60";

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
