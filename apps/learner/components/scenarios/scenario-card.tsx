import Link from "next/link";

import {
  buttonPrimary,
  buttonQuiet,
  card,
  eyebrow,
  focusRing,
} from "@dp/ui/styles";
import type { ScenarioSummary } from "@dp/domain/scenario";
import { scenarioCitation } from "@/lib/scenarios/citation";
import { cn } from "@dp/ui/utils";

/**
 * One scenario as a card.
 *
 * The card's single primary action is decided by the type, which is the whole
 * point of the type: a dialogue is practised in the chat, a comprehension is
 * read and answered on its own page. The title links to the detail page in
 * both cases, so a dialogue's script can be studied before it is performed.
 */

const KIND_LABELS: Readonly<Record<ScenarioSummary["kind"], string>> = {
  dialogue: "Dialogue",
  reading: "Reading",
  telephone: "Telephone menu",
  announcement: "Train announcement",
};

export function ScenarioCard({
  scenario,
  practiceAction,
}: {
  scenario: ScenarioSummary;
  practiceAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <article className={cn(card, "flex flex-col gap-3")}>
      <p className={eyebrow}>
        {KIND_LABELS[scenario.kind]} · {scenario.targetLevel}
      </p>

      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-semibold tracking-tight text-chalk">
          <Link
            href={`/scenarios/${scenario.slug}`}
            className={cn("rounded-sm hover:text-apricot", focusRing)}
          >
            {scenario.title}
          </Link>
        </h3>
        <p className="font-display text-sm text-chalk/50">{scenario.titleEnglish}</p>
      </div>

      <p className="flex-1 text-sm leading-relaxed text-chalk/70">
        {scenario.description}
      </p>

      <p className="text-xs text-chalk/40">Source: {scenarioCitation(scenario)}</p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Both kinds practise in the chat now: a dialogue as a roleplay, a
            comprehension as a passage the tutor asks about — where wrong
            answers are explained and mistakes count towards the record. */}
        <form action={practiceAction}>
          <input type="hidden" name="slug" value={scenario.slug} />
          <button type="submit" className={cn(buttonPrimary, "px-4 py-2 text-sm")}>
            {scenario.type === "dialogue"
              ? "Practice Dialogue (AI Chat)"
              : "Practice Reading (AI Chat)"}
          </button>
        </form>
        <Link
          href={`/scenarios/${scenario.slug}`}
          className={cn(buttonQuiet, "px-4 py-2 text-sm")}
        >
          {scenario.type === "dialogue" ? "Read the script" : "Read & self-check"}
        </Link>
      </div>
    </article>
  );
}
