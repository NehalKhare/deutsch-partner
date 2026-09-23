
import {
  advanceRunAction,
  removeRunAction,
  retryRunAction,
  startScanAction,
} from "../actions";
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
import { boardTotals } from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

export const metadata = { title: "Market scans & runs — Deutsch Partner" };

/** The same window the board reads. An operator page, not a feed. */
const BOARD_LIMIT = 50;

/**
 * The operating half of product ops: scans, and the runs they start.
 *
 * Split from the proposals board because the two are different jobs. Deciding
 * on a proposal is reading and judging; this page is machinery, and the runs
 * panel refreshes itself every few seconds while anything is moving. A page
 * that redraws under a person mid-sentence is the wrong page to be deciding
 * on, and a board that redrew was the reason.
 *
 * The order is cause before effect: the button that starts a scan, then the
 * runs it appears in. What learners say about the trainer used to close this
 * page, because a scan reads it first; it has its own room now, since that is
 * a fact about the pipeline rather than a reason to scroll past a run queue.
 *
 * The gates are the same two as everywhere else in this segment, and both are
 * on the server: the operator allowlist, 404 rather than 403, and RLS with no
 * policy at all behind it.
 */
export default async function ProductOpsRunsPage() {
  await requireOperator({ route: "/product/runs" });

  const { runs } = createProductOpsReader();
  const board = await runs.board(BOARD_LIMIT);

  const header = (
    <header className="flex flex-col gap-2">
      <p className={eyebrow}>Operations</p>
      <h1 className={pageTitle}>Market scans & runs</h1>
      <p className={cn(prose, "max-w-2xl")}>
        Where the work happens: start a scan and watch what it does. What comes
        out of one is decided under Feature proposals.
      </p>
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

    </main>
  );
}
