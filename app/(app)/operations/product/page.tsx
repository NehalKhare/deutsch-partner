import { notFound } from "next/navigation";

import { OpsSwitch } from "@/components/operations/ops-switch";
import { ProposalBoard } from "@/components/operations/proposal-board";
import {
  eyebrow,
  page,
  pageTitle,
  prose,
  sectionTitle,
  stat,
} from "@/components/ui/styles";
import { createProductOpsReader } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";
import { boardTotals } from "@/lib/dashboard/product-ops";
import { cn } from "@/lib/utils";

export const metadata = { title: "Product ops — Deutsch Partner" };

/** As many as the board function will return. An operator page, not a feed. */
const BOARD_LIMIT = 50;

/**
 * The product-ops board: every proposal, and whose move each one is.
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
 *
 * Nothing on this page moves on its own. The scan form, the live run cards and
 * the learner feedback are next door under "Market scans & runs", because the
 * runs panel polls itself while anything is working and a page that redraws
 * under a person is the wrong page to be deciding on. The two numbers here
 * that belong to that page are labelled as its own, with the way over beside
 * them.
 */
export default async function ProductOpsPage() {
  const learnerId = await requireAuthenticatedUserId();
  if (!isOperator(learnerId)) notFound();

  const { runs } = createProductOpsReader();
  const board = await runs.board(BOARD_LIMIT);

  const header = (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className={eyebrow}>Operations</p>
        <h1 className={pageTitle}>Product ops</h1>
        <p className={cn(prose, "max-w-2xl")}>
          A market scan proposes a feature, you approve it, a PRD and an
          implementation plan follow, and you accept or reject the plan. The
          plan is the deliverable: copy it and carry it into your own tools.
          Nothing here writes to the repository.
        </p>
      </div>
      <OpsSwitch to="runs" className="shrink-0" />
    </header>
  );

  if (!board.ok) {
    return (
      <main className={cn(page, "max-w-4xl")}>
        {header}
        <p className={prose}>The board could not be read.</p>
      </main>
    );
  }

  const totals = boardTotals(board.data);

  const tiles: readonly { label: string; value: number }[] = [
    { label: "Proposals", value: totals.proposals },
    { label: "Awaiting you", value: totals.awaitingYou },
    { label: "Awaiting the worker", value: totals.awaitingWorker },
    { label: "Running", value: totals.running },
  ];

  return (
    <main className={cn(page, "max-w-6xl")}>
      {header}

      <div className="flex flex-col gap-3">
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
        {/* The last two tiles are counts of runs, and a run is read, nudged
            and retried on the other page. The way there belongs beside the
            figures that point at it. */}
        <div className="flex flex-wrap items-center gap-3">
          <OpsSwitch to="runs" tone="quiet" />
          <p className="font-display text-xs text-chalk/40">
            The runs behind these figures, and the scan that starts one.
          </p>
        </div>
      </div>

      <section aria-labelledby="board-heading" className="flex flex-col gap-3">
        <h2 id="board-heading" className={sectionTitle}>
          Proposals
        </h2>
        <ProposalBoard board={board.data} />
      </section>
    </main>
  );
}
