import Link from "next/link";

import { TrainerInvite } from "@/components/review/trainer-invite";
import {
  buttonQuiet,
  card,
  eyebrow,
  pageTitle,
  prose,
  sectionTitle,
} from "@dp/ui/styles";
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
 * The review session.
 *
 * Two reads and one pure function. What is due, what is weak and what keeps
 * going wrong are all facts the database already holds; the scheduling
 * arithmetic that turns them into a session is in learning/review.ts, where it
 * is unit-tested without a database.
 *
 * Shown in two sections rather than one list — the words to practise and the
 * mistakes that keep coming back are different kinds of work, and a learner
 * scanning the page should see at a glance how much of each is waiting. The
 * mistakes take their places first: a backlog of vocabulary must not push
 * them off the page, for the same reason the trainer reserves them slots.
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

  // "5 words and 2 mistakes to go over." — the sections, counted in the
  // sentence that introduces them.
  const summary = [
    words.length > 0 ? `${words.length} word${words.length === 1 ? "" : "s"}` : null,
    mistakes.length > 0
      ? `${mistakes.length} mistake${mistakes.length === 1 ? "" : "s"}`
      : null,
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
      {/* Title and trainer on one line. The Trainer is what this page is for
          — the list below is what it works through — so it stands beside the
          heading rather than queueing behind it. */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className={pageTitle}>Catch up</h1>
          <p className={prose}>
            {total === 0
              ? "Nothing is due. Come back after your next conversation."
              : `${summary} to go over.`}
          </p>
        </div>
        <TrainerInvite />
      </header>

      {total === 0 ? (
        <Link href="/chat" className={cn(buttonQuiet, "self-start")}>
          Have a conversation instead
        </Link>
      ) : null}

      {/* The coloured dots are the trainer panel's: vocabulary wears the
          growth green, a mistake wears ember. Two pages, one association. */}
      {words.length > 0 ? (
        <section aria-labelledby="words-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2
              id="words-heading"
              className={cn(sectionTitle, "flex items-center gap-2.5")}
            >
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-sprout" />
              Words to practise
            </h2>
            <span className="text-sm tabular-nums text-chalk/45">
              {words.length}
            </span>
          </div>
          <ol className="flex flex-col gap-3">
            {words.map((activity, index) => (
              <li
                key={`${activity.kind}:${activity.subject}:${index}`}
                className={card}
              >
                <p className={eyebrow}>
                  {WORD_KIND_LABELS[activity.kind] ?? activity.kind.replace(/_/gu, " ")}
                </p>
                <p className="mt-2 text-lg leading-relaxed text-chalk">
                  {activity.prompt}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {mistakes.length > 0 ? (
        <section aria-labelledby="mistakes-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2
              id="mistakes-heading"
              className={cn(sectionTitle, "flex items-center gap-2.5")}
            >
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-ember" />
              Mistakes that keep coming back
            </h2>
            <span className="text-sm tabular-nums text-chalk/45">
              {mistakes.length}
            </span>
          </div>
          <ol className="flex flex-col gap-3">
            {/* Named by what goes wrong, described by the recorded note. The
                note is a description of the pattern, not an exercise — the
                trainer writes the exercise when this is drilled. */}
            {mistakes.map((activity, index) => (
              <li key={`${activity.subject}:${index}`} className={card}>
                <p className="font-display font-semibold tracking-tight text-chalk">
                  {activity.subject}
                </p>
                <p className="mt-1.5 leading-relaxed text-chalk/65">
                  {activity.prompt}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section
        aria-labelledby="due-heading"
        className="flex flex-col gap-2 border-t border-haze/60 pt-6"
      >
        <h2 id="due-heading" className={sectionTitle}>
          Overdue
        </h2>
        <p className="text-sm text-chalk/55">
          {overdue} word{overdue === 1 ? "" : "s"} past their review date
          {plan.due[0] ? `, the oldest by ${plan.due[0].overdueDays} day${plan.due[0].overdueDays === 1 ? "" : "s"}` : ""}
          .
        </p>
      </section>
    </main>
  );
}
