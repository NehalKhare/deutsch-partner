import { notFound } from "next/navigation";

import {
  advanceRunAction,
  removeRunAction,
  retryRunAction,
  startScanAction,
} from "./actions";
import { FeedbackPanel } from "@/components/operations/feedback-panel";
import { ProposalBoard } from "@/components/operations/proposal-board";
import { RunsPanel } from "@/components/operations/runs-panel";
import { PendingButton } from "@/components/ui/pending-button";
import {
  buttonPrimary,
  card,
  eyebrow,
  field,
  page,
  pageTitle,
  prose,
  sectionTitle,
  stat,
} from "@/components/ui/styles";
import { createProductOpsReader } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";
import { FEEDBACK_WINDOW_DAYS } from "@/lib/dashboard/learner-feedback";
import { boardTotals } from "@/lib/dashboard/product-ops";
import { cn } from "@/lib/utils";

export const metadata = { title: "Product ops — Deutsch Partner" };

/** As many as the board function will return. An operator page, not a feed. */
const BOARD_LIMIT = 50;

/**
 * The product-ops board.
 *
 * Two gates before anything is read, both on the server. The route checks the
 * operator allowlist and 404s otherwise — not 403, because confirming the page
 * exists tells somebody there is one worth finding. The tables themselves are
 * the third: RLS on with no policy at all, reachable by the secret key and
 * nothing else.
 *
 * What the board is for is deciding what to do next, so every card says whose
 * move it is. Three kinds of "in progress" exist here — the pipeline is
 * working, a person has to decide, a worker has to be run on a machine with a
 * checkout — and a board that drew them the same way would be one an operator
 * has to interpret rather than read.
 */
export default async function ProductOpsPage() {
  const learnerId = await requireAuthenticatedUserId();
  if (!isOperator(learnerId)) notFound();

  const { runs, feedback } = createProductOpsReader();
  const [board, learnerFeedback] = await Promise.all([
    runs.board(BOARD_LIMIT),
    feedback.summary({ days: FEEDBACK_WINDOW_DAYS }),
  ]);

  if (!board.ok) {
    return (
      <main className={cn(page, "max-w-4xl")}>
        <h1 className={pageTitle}>Product ops</h1>
        <p className={prose}>The board could not be read.</p>
      </main>
    );
  }

  const totals = boardTotals(board.data);

  // Which runs a proposal hangs off. Those stay on the board however they
  // ended, because the proposal's reviews are the audit trail.
  const runsWithProposals = new Set(
    board.data.proposals.map((proposal) => proposal.runId),
  );

  const tiles: readonly { label: string; value: number }[] = [
    { label: "Proposals", value: totals.proposals },
    { label: "Awaiting you", value: totals.awaitingYou },
    { label: "Awaiting the worker", value: totals.awaitingWorker },
    { label: "Running", value: totals.running },
  ];

  return (
    <main className={cn(page, "max-w-6xl")}>
      <header className="flex flex-col gap-2">
        <p className={eyebrow}>Operations</p>
        <h1 className={pageTitle}>Product ops</h1>
        <p className={cn(prose, "max-w-2xl")}>
          A market scan proposes a feature, you approve it, a PRD and an
          implementation plan follow, and you accept or reject the plan. The
          plan is the deliverable: copy it and carry it into your own tools.
          Nothing here writes to the repository.
        </p>
      </header>

      <section aria-labelledby="scan-heading" className={cn(card, "flex flex-col gap-3")}>
        <h2 id="scan-heading" className={sectionTitle}>
          Run a market scan
        </h2>
        <form action={startScanAction} className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">What the scan should look for</span>
            <input
              type="text"
              name="brief"
              maxLength={400}
              placeholder="What should it look for? Leave blank for a general scan."
              className={field}
            />
          </label>
          <PendingButton className={buttonPrimary}>Run a scan</PendingButton>
        </form>
        <p className="font-display text-xs text-chalk/45">
          Several model calls, so it runs in the background and this page
          follows it. Every stage is recorded, so a scan that stops halfway is
          one you can nudge on rather than restart.
        </p>
      </section>

      <section aria-labelledby="feedback-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="feedback-heading" className={sectionTitle}>
            What learners say about the trainer
          </h2>
          <p className="text-sm text-chalk/55">
            The last {FEEDBACK_WINDOW_DAYS} days of votes under trainer replies. Every
            scan records this as its first finding, before it searches the web.
          </p>
        </div>
        {learnerFeedback.ok ? (
          <FeedbackPanel summary={learnerFeedback.data} />
        ) : (
          <p className={cn(card, "text-sm text-chalk/70")}>
            Learner feedback could not be read.
          </p>
        )}
      </section>

      <section aria-labelledby="runs-heading" className="flex flex-col gap-3">
        <h2 id="runs-heading" className={sectionTitle}>
          Runs
        </h2>
        <RunsPanel
          runs={board.data.runs}
          asOf={board.data.generatedAt}
          runsWithProposals={runsWithProposals}
          advance={advanceRunAction}
          retry={retryRunAction}
          remove={removeRunAction}
        />
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className={stat}>
            <dt className={eyebrow}>{tile.label}</dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-chalk">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="board-heading" className="flex flex-col gap-3">
        <h2 id="board-heading" className={sectionTitle}>
          Proposals
        </h2>
        <ProposalBoard board={board.data} />
      </section>
    </main>
  );
}
