import Link from "next/link";

import { TrainerInvite } from "@/components/review/trainer-invite";
import { buttonQuiet, focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import { MAX_REVIEW_ITEMS, buildReviewPlan, dueForReview } from "@dp/learning/review";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { createLearnerErrorRepository } from "@dp/db/learner-error-repository";
import { createVocabularyRepository } from "@dp/db/vocabulary-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";

export const metadata = { title: "Catch up — Deutsch Partner" };

/**
 * What each kind of word practice asks for, in the trainer panel's words.
 *
 * The same labels the session agenda shows, because this list and that panel
 * are the same work seen from two pages — a learner who reads "recall" here
 * and "recall" there learns the word once.
 */
const WORD_KIND_LABELS: Readonly<Record<string, string>> = {
  recognise: "meaning",
  recall: "recall",
  use_in_sentence: "use in a sentence",
};

/**
 * How many words the page previews. The sitting can hold twenty; a phone
 * screen holds about six rows beside everything else, and the Trainer works
 * through the whole list anyway — so the rest are counted, not drawn.
 */
const WORD_PREVIEW = 6;

const tile = "flex flex-col gap-0.5 rounded-xl border px-3 py-2";
const tileLabel =
  "font-display text-[0.65rem] font-medium uppercase tracking-[0.14em] text-copy/55";
const tileValue =
  "font-display text-2xl font-semibold leading-none tabular-nums text-copy";
const tileNote = "truncate text-[0.7rem] text-copy/50";

const listPanel = "flex flex-col overflow-hidden rounded-2xl border border-edge/70 bg-panel/70";
const listHeader =
  "flex items-center justify-between gap-3 border-b border-edge/50 px-4 py-2";
const listTitle =
  "flex items-center gap-2 font-display text-sm font-semibold tracking-tight text-copy";
const listCount = "font-display text-xs tabular-nums text-copy/45";

/**
 * A row that folds open to its full text. Native <details>, so it works
 * before React loads and needs no client component. The ring is drawn inset:
 * the panel clips overflow, and an outset ring would be cut off.
 */
const rowSummary =
  "flex cursor-pointer list-none gap-2.5 px-4 py-2 transition-colors " +
  "hover:bg-panel [&::-webkit-details-marker]:hidden " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 " +
  "focus-visible:outline-brand";

function RowChevron() {
  return (
    <span
      aria-hidden
      className="ml-auto shrink-0 self-center font-display text-copy/40 transition-transform group-open:rotate-90"
    >
      ›
    </span>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The review session.
 *
 * Two reads and one pure function. What is due, what is weak and what keeps
 * going wrong are all facts the database already holds; the scheduling
 * arithmetic that turns them into a session is in learning/review.ts, where it
 * is unit-tested without a database.
 *
 * Laid out to be read without scrolling: the counts first, as a strip of
 * tiles, then the mistakes and the words as dense lists — side by side where
 * the screen allows. The mistakes come first: a backlog of vocabulary must
 * not push them off the page, for the same reason the trainer reserves them
 * slots.
 */
export default async function ReviewPage() {
  const learnerId = await requireAuthenticatedUserId();
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const now = new Date();

  const repository = createVocabularyRepository(supabase);
  const [vocabulary, errors] = await Promise.all([
    repository.listForLearner(learnerId, 200),
    createLearnerErrorRepository(supabase).listUnresolved(learnerId, 5),
  ]);

  // The words the progress rows point at. Without them the plan has only ids,
  // and an id is not something to ask a learner about.
  const records = vocabulary.ok ? vocabulary.data : [];
  const items = await repository.findByIds(
    records.map((record) => record.vocabularyItemId),
  );

  const plan = buildReviewPlan({
    vocabulary: records,
    items: items.ok ? items.data : [],
    recurringErrors: errors.ok
      ? errors.data.map((error) => ({
          errorType: error.errorType,
          pattern: error.pattern,
        }))
      : [],
    now,
  });

  // The sitting, sectioned. Mistakes are few (at most one per category) and
  // always shown; the words fill what the cap leaves, so the total is still
  // the number the nav badge counts.
  const mistakes = plan.mistakeActivities;
  const words = plan.vocabularyActivities.slice(
    0,
    Math.max(0, MAX_REVIEW_ITEMS - mistakes.length),
  );
  const total = words.length + mistakes.length;
  const shownWords = words.slice(0, WORD_PREVIEW);
  const hiddenWords = words.length - shownWords.length;

  // "5 words and 2 mistakes to go over." — the sections, counted in the
  // sentence that introduces them.
  const summary = [
    words.length > 0 ? plural(words.length, "word") : null,
    mistakes.length > 0 ? plural(mistakes.length, "mistake") : null,
  ]
    .filter((part) => part !== null)
    .join(" and ");

  // The overdue total, uncapped.
  //
  // plan.due is the session's list and is capped at MAX_REVIEW_ITEMS, which is
  // the right bound for a sitting and the wrong number for a sentence about
  // how far behind somebody is: at twenty-one overdue words the capped list
  // would have this page say twenty while the nav badge — counted in the
  // database — said the truth.
  const overdue = dueForReview(records, now, records.length).length;
  const oldestDays = plan.due[0]?.overdueDays;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 md:gap-5 md:px-8 md:py-8">
      {/* Title and trainer on one line. The Trainer is what this page is for
          — the lists below are what it works through — so it stands beside
          the heading rather than queueing behind it. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Catch up
          </h1>
          <p className="text-sm leading-snug text-copy/65">
            {total === 0
              ? "Nothing is due. Come back after your next conversation."
              : `${summary} to go over.`}
          </p>
        </div>
        <TrainerInvite />
      </header>

      {/* The counts, before the content. Overdue leads: it is the one number
          that says how far behind the learner is, and it used to sit at the
          very bottom of the page. */}
      <div className="grid grid-cols-3 gap-2">
        <section
          aria-labelledby="due-heading"
          className={cn(
            tile,
            overdue > 0 ? "border-ember/40 bg-ember/10" : "border-edge/70 bg-panel/70",
          )}
        >
          <h2 id="due-heading" className={tileLabel}>
            Overdue
          </h2>
          <p className={cn(tileValue, overdue > 0 && "text-ember")}>{overdue}</p>
          <p className={tileNote}>
            {oldestDays !== undefined
              ? `oldest ${plural(oldestDays, "day")}`
              : "all on time"}
          </p>
        </section>
        <div className={cn(tile, "border-edge/70 bg-panel/70")}>
          <p className={tileLabel}>Mistakes</p>
          <p className={tileValue}>{mistakes.length}</p>
          <p className={tileNote}>recurring</p>
        </div>
        <div className={cn(tile, "border-edge/70 bg-panel/70")}>
          <p className={tileLabel}>Words</p>
          <p className={tileValue}>{words.length}</p>
          <p className={tileNote}>to practise</p>
        </div>
      </div>

      {total === 0 ? (
        <Link href="/chat" className={cn(buttonQuiet, "self-start")}>
          Have a conversation instead
        </Link>
      ) : null}

      {total > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {/* The coloured dots are the trainer panel's: vocabulary wears the
              growth green, a mistake wears ember. Two pages, one association. */}
          {mistakes.length > 0 ? (
            <section aria-labelledby="mistakes-heading" className={listPanel}>
              <div className={listHeader}>
                <h2 id="mistakes-heading" className={listTitle}>
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-ember" />
                  Mistakes that keep coming back
                </h2>
                <span className={listCount}>{mistakes.length}</span>
              </div>
              <ol className="divide-y divide-edge/40">
                {/* Named by what goes wrong, described by the recorded note.
                    The note is a description of the pattern, not an exercise
                    — the trainer writes the exercise when this is drilled. */}
                {mistakes.map((activity, index) => (
                  <li key={`${activity.subject}:${index}`}>
                    <details className="group">
                      <summary className={rowSummary}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-display text-sm font-semibold tracking-tight text-copy group-open:whitespace-normal">
                            {activity.subject}
                          </span>
                          <span className="line-clamp-1 text-sm leading-snug text-copy/60 group-open:line-clamp-none">
                            {activity.prompt}
                          </span>
                        </span>
                        <RowChevron />
                      </summary>
                    </details>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {words.length > 0 ? (
            <section aria-labelledby="words-heading" className={listPanel}>
              <div className={listHeader}>
                <h2 id="words-heading" className={listTitle}>
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-sprout" />
                  Words to practise
                </h2>
                <span className={listCount}>{words.length}</span>
              </div>
              <ol className="divide-y divide-edge/40">
                {shownWords.map((activity, index) => (
                  <li key={`${activity.kind}:${activity.subject}:${index}`}>
                    <details className="group">
                      <summary className={cn(rowSummary, "items-baseline")}>
                        <span className="shrink-0 rounded-full bg-sprout/15 px-2 py-0.5 font-display text-[0.65rem] font-medium uppercase tracking-widest text-copy/70">
                          {WORD_KIND_LABELS[activity.kind] ??
                            activity.kind.replace(/_/gu, " ")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-copy group-open:whitespace-normal">
                          {activity.prompt}
                        </span>
                        <RowChevron />
                      </summary>
                    </details>
                  </li>
                ))}
              </ol>
              {hiddenWords > 0 ? (
                <Link
                  href="/trainer"
                  className={cn(
                    "mt-auto border-t border-edge/50 px-4 py-2 font-display text-xs text-copy/60 transition-colors hover:text-copy",
                    focusRing,
                  )}
                >
                  +{hiddenWords} more — the trainer works through them all →
                </Link>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
