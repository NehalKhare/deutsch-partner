import Link from "next/link";

import { TrainerInvite } from "@/components/review/trainer-invite";
import {
  buttonQuiet,
  card,
  eyebrow,
  pageTitle,
  prose,
  sectionTitle,
} from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import { buildReviewPlan, dueForReview } from "@/learning/review";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { createLearnerErrorRepository } from "@/repositories/learner-error-repository";
import { createVocabularyRepository } from "@/repositories/vocabulary-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

export const metadata = { title: "Catch up — Deutsch Partner" };

/**
 * The review session.
 *
 * Two reads and one pure function. What is due, what is weak and what keeps
 * going wrong are all facts the database already holds; the scheduling
 * arithmetic that turns them into a session is in learning/review.ts, where it
 * is unit-tested without a database.
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
            {plan.activities.length === 0
              ? "Nothing is due. Come back after your next conversation."
              : `${plan.activities.length} thing${plan.activities.length === 1 ? "" : "s"} to go over.`}
          </p>
        </div>
        <TrainerInvite />
      </header>

      {plan.activities.length === 0 ? (
        <Link href="/chat" className={cn(buttonQuiet, "self-start")}>
          Have a conversation instead
        </Link>
      ) : (
        <ol className="flex flex-col gap-3">
          {plan.activities.map((activity, index) => (
            <li
              key={`${activity.kind}:${activity.subject}:${index}`}
              className={card}
            >
              <p className={eyebrow}>{activity.kind.replace(/_/gu, " ")}</p>
              <p className="mt-2 text-lg leading-relaxed text-chalk">
                {activity.prompt}
              </p>
            </li>
          ))}
        </ol>
      )}

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
