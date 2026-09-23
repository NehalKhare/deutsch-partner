"use client";

import { AnimatePresence, motion } from "framer-motion";
import { FileText, MessageSquare } from "lucide-react";
import Link from "next/link";

import { LAYOUT_SPRING, type ScenarioView } from "@/components/scenarios/view";
import { buttonPrimary, buttonQuiet, focusRing } from "@dp/ui/styles";
import type { ScenarioSummary } from "@dp/domain/scenario";
import { scenarioCitation } from "@/lib/scenarios/citation";
import { cn } from "@dp/ui/utils";

/**
 * One scenario, in whichever shape the reader asked for.
 *
 * The card's single primary action is decided by the type, which is the whole
 * point of the type: a dialogue is practised in the chat, a comprehension is
 * read and answered on its own page. The title links to the detail page in
 * both cases, so a dialogue's script can be studied before it is performed.
 *
 * Grid and list are one tree with different classes rather than two
 * components. Framer Motion animates between two layouts by measuring the
 * same DOM element before and after; render a different subtree and there is
 * nothing to measure, so the cards jump. That constraint is why the actions
 * keep their `aria-label` when they lose their text: the same button, wearing
 * less, and still announcing itself the same way to anything that cannot see
 * the icon.
 */

const KIND_LABELS: Readonly<Record<ScenarioSummary["kind"], string>> = {
  dialogue: "Dialogue",
  reading: "Reading",
  telephone: "Telephone menu",
  announcement: "Train announcement",
};

/**
 * The warm lift under a card. Written with the shade token rather than a hex,
 * so the shadow is faint ink on the light theme and real depth on the dark
 * one — a shadow tuned for cream paper is invisible on a near-black page.
 */
const LIFT =
  "shadow-[0_4px_24px_-6px_color-mix(in_oklab,var(--shade)_22%,transparent)]";

/**
 * Level and kind, as a status pill rather than a line of small caps.
 *
 * `self-start` earns its place: in the grid the pill is a flex *item* in a
 * column, and a column stretches its children, so without it the badge is a
 * full-width band across the top of the card rather than a pill.
 */
const BADGE =
  "inline-flex shrink-0 items-center self-start rounded-md bg-brand/10 " +
  "px-1.5 py-0.5 font-display text-[0.65rem] font-semibold tracking-[0.06em] " +
  "text-brand uppercase";

export function ScenarioCard({
  scenario,
  view,
  practiceAction,
}: {
  scenario: ScenarioSummary;
  view: ScenarioView;
  practiceAction: (formData: FormData) => void | Promise<void>;
}) {
  const list = view === "list";

  /*
   * Two names for each action: the one a screen reader hears, which says
   * which of the two practices this is, and the one printed on the button,
   * which is one word because the button is a quarter of a card wide and
   * "Practice Dialogue (AI Chat)" set across three lines is not a button.
   * The printed word is a substring of the spoken name, which is what keeps
   * voice control working — "click practice" has to hit something.
   */
  const practiceLabel =
    scenario.type === "dialogue"
      ? "Practice Dialogue (AI Chat)"
      : "Practice Reading (AI Chat)";
  const readLabel =
    scenario.type === "dialogue" ? "Read the script" : "Read & self-check";
  const readWord = scenario.type === "dialogue" ? "Script" : "Self-check";

  return (
    <motion.article
      layout
      transition={LAYOUT_SPRING}
      className={cn(
        "w-full rounded-xl border border-edge/60 bg-raised/90 transition-colors",
        "hover:border-brand/40",
        LIFT,
        list
          ? "flex items-center gap-3 px-3 py-1.5"
          : "flex h-full flex-col gap-2 p-4",
      )}
    >
      <motion.p
        layout="position"
        transition={LAYOUT_SPRING}
        className={cn(BADGE, list && "self-center")}
      >
        {list
          ? scenario.targetLevel
          : `${KIND_LABELS[scenario.kind]} · ${scenario.targetLevel}`}
      </motion.p>

      <motion.div
        layout="position"
        transition={LAYOUT_SPRING}
        className={cn("flex min-w-0 flex-col", list ? "flex-1" : "gap-0.5")}
      >
        <h3
          className={cn(
            "font-display font-semibold tracking-tight text-copy",
            list ? "truncate text-sm" : "text-base leading-snug",
          )}
        >
          <Link
            href={`/scenarios/${scenario.slug}`}
            className={cn("rounded-sm hover:text-brand", focusRing)}
          >
            {scenario.title}
          </Link>
        </h3>
        <p className="truncate font-display text-xs text-copy/70 opacity-70">
          {scenario.titleEnglish}
          {list && ` · ${KIND_LABELS[scenario.kind]}`}
        </p>
      </motion.div>

      {/* The description is what the grid is for and what the list trades
          away; fifteen rows only fit on a screen if something goes. */}
      <AnimatePresence initial={false}>
        {!list && (
          <motion.p
            key="description"
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={LAYOUT_SPRING}
            className="line-clamp-2 flex-1 text-xs leading-relaxed text-copy/70"
          >
            {scenario.description}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Provenance travels with the card in both shapes — a retrieved result
          nobody can trace back to its document is not evidence of anything —
          but it is a footnote, so it gets one line and no more. */}
      <motion.p
        layout="position"
        transition={LAYOUT_SPRING}
        className={cn(
          "truncate text-[0.65rem] text-copy/40",
          list && "hidden shrink-0 lg:block lg:max-w-56",
        )}
      >
        Source: {scenarioCitation(scenario)}
      </motion.p>

      <motion.div
        layout
        transition={LAYOUT_SPRING}
        className={cn(
          "flex shrink-0 items-center",
          list ? "gap-1.5" : "mt-auto gap-2 pt-1",
        )}
      >
        {/* Both kinds practise in the chat now: a dialogue as a roleplay, a
            comprehension as a passage the tutor asks about — where wrong
            answers are explained and mistakes count towards the record. */}
        <form action={practiceAction} className={list ? "" : "flex-1"}>
          <input type="hidden" name="slug" value={scenario.slug} />
          <button
            type="submit"
            aria-label={practiceLabel}
            title={practiceLabel}
            className={cn(
              buttonPrimary,
              "gap-1.5 rounded-lg",
              list
                ? "size-8 p-0"
                : "w-full px-2 py-1.5 text-xs hover:scale-100 hover:brightness-110",
            )}
          >
            <MessageSquare aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
            {!list && <span className="truncate">Practice</span>}
          </button>
        </form>

        <Link
          href={`/scenarios/${scenario.slug}`}
          aria-label={readLabel}
          title={readLabel}
          className={cn(
            buttonQuiet,
            "gap-1.5 rounded-lg border-brand/30 text-brand/90",
            "hover:border-brand/60 hover:text-brand",
            list ? "size-8 p-0" : "flex-1 px-2 py-1.5 text-xs",
          )}
        >
          <FileText aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
          {!list && <span className="truncate">{readWord}</span>}
        </Link>
      </motion.div>
    </motion.article>
  );
}
