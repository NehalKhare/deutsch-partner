import { notFound } from "next/navigation";

import { ComprehensionQuiz } from "@/components/scenarios/comprehension-quiz";
import {
  buttonPrimary,
  card,
  eyebrow,
  pageTitle,
  prose,
  sectionTitle,
} from "@dp/ui/styles";
import { practiceScenarioAction } from "@/app/(app)/scenarios/actions";
import type { Scenario } from "@dp/domain/scenario";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { scenarioCitation } from "@/lib/scenarios/citation";
import { createScenarioRepository } from "@dp/db/scenario-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";
import { cn } from "@dp/ui/utils";

export const metadata = { title: "Scenario" };

const KIND_LABELS: Readonly<Record<Scenario["kind"], string>> = {
  dialogue: "Dialogue",
  reading: "Reading comprehension",
  telephone: "Telephone menu",
  announcement: "Train announcement",
};

/**
 * One scenario, in full.
 *
 * A dialogue shows its script — the German, the English, the vocabulary —
 * with the roleplay one button away. A comprehension shows the passage and
 * asks its questions; grading is a string check in the browser, so reading
 * practice costs no model call at all. A malformed slug reads the same as a
 * missing one: not found, confirming nothing.
 */
export default async function ScenarioPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireAuthenticatedUserId();
  const { slug } = await params;

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const scenario = await createScenarioRepository(supabase).getBySlug(slug);

  if (!scenario.ok) notFound();
  const item = scenario.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
      <header className="flex flex-col gap-2">
        <p className={eyebrow}>
          {KIND_LABELS[item.kind]} · {item.targetLevel}
        </p>
        <h1 className={pageTitle}>{item.title}</h1>
        <p className="font-display text-lg text-copy/60">{item.titleEnglish}</p>
        <p className={cn(prose, "mt-2")}>{item.description}</p>
        <p className="mt-1 text-xs text-copy/40">
          Source: {scenarioCitation(item)}
        </p>
      </header>

      {item.type === "dialogue" ? (
        <>
          <form action={practiceScenarioAction}>
            <input type="hidden" name="slug" value={item.slug} />
            <button type="submit" className={buttonPrimary}>
              Practice Dialogue (AI Chat)
            </button>
          </form>

          <section aria-labelledby="script-heading" className="flex flex-col gap-3">
            <h2 id="script-heading" className={sectionTitle}>
              The script
            </h2>
            <ol className="flex flex-col gap-3">
              {item.content.lines.map((line, index) => (
                <li key={`${index}-${line.german}`} className={card}>
                  <p className={eyebrow}>{line.speaker}</p>
                  <p className="mt-1 font-body leading-relaxed text-copy">
                    {line.german}
                  </p>
                  {line.english && (
                    <p className="mt-1 text-sm leading-relaxed text-copy/60">
                      {line.english}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <>
          {/* The practice that counts: the tutor asks about the passage,
              explains wrong answers in English, and every reply flows through
              the same mistake tracking as an ordinary conversation. The quiz
              below stays as the free self-check. */}
          <form action={practiceScenarioAction}>
            <input type="hidden" name="slug" value={item.slug} />
            <button type="submit" className={buttonPrimary}>
              Practice Reading (AI Chat)
            </button>
          </form>

          <section aria-labelledby="passage-heading" className="flex flex-col gap-3">
            <h2 id="passage-heading" className={sectionTitle}>
              Read
            </h2>
            <div className={card}>
              <p className="font-body text-lg leading-relaxed text-copy">
                {item.content.passage}
              </p>
              {item.content.passageEnglish && (
                <details className="mt-4">
                  <summary className="cursor-pointer font-display text-sm text-copy/60 hover:text-copy">
                    Show English translation
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-copy/70">
                    {item.content.passageEnglish}
                  </p>
                </details>
              )}
            </div>
          </section>

          <section aria-labelledby="questions-heading" className="flex flex-col gap-3">
            <h2 id="questions-heading" className={sectionTitle}>
              Answer
            </h2>
            <ComprehensionQuiz questions={item.content.questions} />
          </section>
        </>
      )}

      {item.vocabulary.length > 0 && (
        <section
          aria-labelledby="vocabulary-heading"
          className="flex flex-col gap-2 border-t border-edge/60 pt-6"
        >
          <h2 id="vocabulary-heading" className={sectionTitle}>
            Key vocabulary
          </h2>
          <ul className="flex flex-col gap-1">
            {item.vocabulary.map((entry) => (
              <li key={entry.term} className="text-sm leading-relaxed">
                <span className="text-copy">{entry.term}</span>
                <span className="text-copy/60"> — {entry.meaning}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
