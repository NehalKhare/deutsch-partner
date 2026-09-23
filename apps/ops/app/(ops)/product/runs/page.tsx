
import {
  advanceRunAction,
  removeRunAction,
  retryRunAction,
  startScanAction,
} from "../actions";
import { FeedbackPanel } from "@/components/operations/feedback-panel";
import { OpsSwitch } from "@/components/operations/ops-switch";
import { RunsPanel } from "@/components/operations/runs-panel";
import { PendingButton } from "@dp/ui/pending-button";
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
} from "@dp/ui/styles";
import { createProductOpsReader } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import { FEEDBACK_WINDOW_DAYS } from "@dp/db/learner-feedback-repository";
import { boardTotals } from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

export const metadata = { title: "Market scans & runs — Deutsch Partner" };

/** The same window the board reads. An operator page, not a feed. */
const BOARD_LIMIT = 50;

/**
 * The operating half of product ops: scans, the runs they start, and what
 * learners said about the trainer.
 *
 * Split from the proposals board because the two are different jobs. Deciding
 * on a proposal is reading and judging; this page is machinery, and the runs
 * panel refreshes itself every few seconds while anything is moving. A page
 * that redraws under a person mid-sentence is the wrong page to be deciding
 * on, and a board that redrew was the reason.
 *
 * The order is cause before effect: the button that starts a scan, the runs it
 * appears in, then the learner feedback every scan records as its first
 * finding before it searches the web. That last section is the input to the
 * next scan rather than the output of the last one, which is why it reads
 * better at the end than between the button and its result.
 *
 * The gates are the same two as everywhere else in this segment, and both are
 * on the server: the operator allowlist, 404 rather than 403, and RLS with no
 * policy at all behind it.
 */
export default async function ProductOpsRunsPage() {
  await requireOperator({ route: "/product/runs" });

  const { runs, feedback } = createProductOpsReader();
  const [board, learnerFeedback] = await Promise.all([
    runs.board(BOARD_LIMIT),
    feedback.summary({ days: FEEDBACK_WINDOW_DAYS }),
  ]);

  const header = (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className={eyebrow}>Operations</p>
        <h1 className={pageTitle}>Market scans & runs</h1>
        <p className={cn(prose, "max-w-2xl")}>
          Where the work happens: start a scan, watch what it does, and read
          what learners have been saying about the trainer. What comes out of a
          scan is decided on the proposals board.
        </p>
      </div>
      <OpsSwitch to="proposals" className="shrink-0" />
    </header>
  );

  if (!board.ok) {
    return (
      <main className={cn(page, "max-w-4xl")}>
        {header}
        <p className={prose}>The runs could not be read.</p>
      </main>
    );
  }

  const totals = boardTotals(board.data);

  // Which runs a proposal hangs off. Those stay on the board however they
  // ended, because the proposal's reviews are the audit trail.
  const runsWithProposals = new Set(
    board.data.proposals.map((proposal) => proposal.runId),
  );

  // About the runs, all four of them — the proposal counts belong to the page
  // that shows proposals.
  const tiles: readonly { label: string; value: number }[] = [
    { label: "Runs", value: board.data.runs.length },
    { label: "Running", value: totals.running },
    { label: "Awaiting the worker", value: totals.awaitingWorker },
    { label: "Stopped", value: totals.failed },
  ];

  return (
    <main className={cn(page, "max-w-6xl")}>
      {header}

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
        <p className="font-display text-xs text-copy/45">
          Several model calls, so it runs in the background and this page
          follows it. Every stage is recorded, so a scan that stops halfway is
          one you can nudge on rather than restart.
        </p>
      </section>

      <section aria-labelledby="runs-heading" className="flex flex-col gap-3">
        <h2 id="runs-heading" className={sectionTitle}>
          Runs
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className={stat}>
              <dt className={eyebrow}>{tile.label}</dt>
              <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-copy">
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
        <RunsPanel
          runs={board.data.runs}
          asOf={board.data.generatedAt}
          runsWithProposals={runsWithProposals}
          advance={advanceRunAction}
          retry={retryRunAction}
          remove={removeRunAction}
        />
      </section>

      <section aria-labelledby="feedback-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="feedback-heading" className={sectionTitle}>
            What learners say about the trainer
          </h2>
          <p className="text-sm text-copy/60">
            The last {FEEDBACK_WINDOW_DAYS} days of votes under trainer replies. Every
            scan records this as its first finding, before it searches the web.
          </p>
        </div>
        {learnerFeedback.ok ? (
          <FeedbackPanel summary={learnerFeedback.data} />
        ) : (
          <p className={cn(card, "text-sm text-copy/70")}>
            Learner feedback could not be read.
          </p>
        )}
      </section>
    </main>
  );
}
