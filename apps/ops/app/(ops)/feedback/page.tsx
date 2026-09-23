import { FeedbackPanel } from "@/components/operations/feedback-panel";
import { card, eyebrow, page, pageTitle, prose } from "@dp/ui/styles";
import { createProductOpsReader } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import { FEEDBACK_WINDOW_DAYS } from "@dp/db/learner-feedback-repository";
import { cn } from "@dp/ui/utils";

export const metadata = { title: "Trainer feedback — Deutsch Partner" };

/**
 * What learners say about the trainer.
 *
 * Its own page rather than the last band of the runs page. It was put there
 * because a scan reads it as its first finding, which is a fact about how the
 * pipeline works rather than a reason to make somebody scroll past a run
 * queue to reach it. This is the only page in the operator app that reports on
 * the product as learners find it, and the questions it answers — is the
 * trainer getting better, did the last prompt version help, what are people
 * actually complaining about — are asked on their own, not while watching a
 * scan.
 *
 * Nothing here names a learner. The notes are learners' own words and are
 * rendered as text, never as markup.
 *
 * The gates are the same two as everywhere else in this segment, and both are
 * on the server: the operator allowlist, 404 rather than 403, and RLS with no
 * policy at all behind it.
 */
export default async function TrainerFeedbackPage() {
  await requireOperator({ route: "/feedback" });

  const { feedback } = createProductOpsReader();
  const summary = await feedback.summary({ days: FEEDBACK_WINDOW_DAYS });

  return (
    <main className={cn(page, "max-w-6xl")}>
      <header className="flex flex-col gap-2">
        <p className={eyebrow}>Operations</p>
        <h1 className={pageTitle}>Trainer feedback</h1>
        <p className={cn(prose, "max-w-2xl")}>
          The last {FEEDBACK_WINDOW_DAYS} days of votes under trainer replies.
          Every market scan records this as its first finding, before it
          searches the web, so what is here is what the next proposal starts
          from.
        </p>
      </header>

      {summary.ok ? (
        <FeedbackPanel summary={summary.data} />
      ) : (
        <p className={cn(card, "text-sm text-copy/70")}>
          Learner feedback could not be read.
        </p>
      )}
    </main>
  );
}
