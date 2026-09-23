import Link from "next/link";

import { ProposalBoard } from "@/components/operations/proposal-board";
import {
  eyebrow,
  linkInline,
  page,
  pageTitle,
  prose,
  statPill,
  statPillLabel,
  statPillValue,
} from "@dp/ui/styles";
import { createProductOpsReader } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import { boardTotals } from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

export const metadata = { title: "Feature proposals — Deutsch Partner" };

/** As many as the board function will return. An operator page, not a feed. */
const BOARD_LIMIT = 50;

/**
 * The proposals board: every feature a scan has proposed, and whose move
 * each one is.
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
 * Nothing on this page moves on its own. The scan form and the live run cards
 * are next door under "Market Scan", because the runs panel polls itself while
 * anything is working and a page that redraws under a person is the wrong page
 * to be deciding on. The two numbers here that belong to that page say so, and
 * the nav is the way over.
 *
 * The counts ride in the header as pills rather than as a band of tiles across
 * the page. They are context — how much is waiting — and a band of four tiles
 * claimed to be the subject of the page and pushed the board, which is the
 * subject, most of a screen down.
 */
export default async function ProductOpsPage() {
  await requireOperator({ route: "/product" });

  const { runs } = createProductOpsReader();
  const board = await runs.board(BOARD_LIMIT);

  const title = (
    <div className="flex flex-col gap-2">
      <p className={eyebrow}>Operations</p>
      <h1 className={pageTitle}>Feature proposals</h1>
    </div>
  );

  const intro = (
    <p className={cn(prose, "max-w-2xl lg:col-span-2")}>
      A market scan proposes a feature, you approve it, a PRD and an
      implementation plan follow, and you accept or reject the plan. The plan is
      the deliverable: copy it and carry it into your own tools. Nothing here
      writes to the repository.
    </p>
  );

  if (!board.ok) {
    return (
      <main className={cn(page, "max-w-4xl")}>
        <header className="flex flex-col gap-3">
          {title}
          {intro}
        </header>
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
      {/*
        * A grid rather than a row, so the pills share a line with the title
        * and the paragraph runs full width underneath. As a flex row the left
        * column reserved its widest child's width — the paragraph's — for the
        * whole header, which left the pills too little room and wrapped one of
        * them onto a line of its own at every window size.
        */}
      <header className="grid gap-x-8 gap-y-3 lg:grid-cols-[1fr_auto]">
        {title}

        <div className="flex flex-col gap-2 lg:items-end">
          <dl className="flex flex-wrap gap-2 lg:justify-end">
            {tiles.map((tile) => (
              <div key={tile.label} className={statPill}>
                <dt className={statPillLabel}>{tile.label}</dt>
                <dd className={statPillValue}>{tile.value}</dd>
              </div>
            ))}
          </dl>
          {/* The last two pills are counts of runs, and a run is read, nudged
              and retried on the other page. Quiet, because the nav already
              offers the room — this only says which figures live there. */}
          <p className="font-display text-xs text-copy/60">
            <Link href="/product/runs" className={linkInline}>
              Market Scan
            </Link>{" "}
            has the runs behind these figures.
          </p>
        </div>

        {intro}
      </header>

      {/* The heading is for a screen reader only: the page is already called
          "Feature proposals", and a band reading "Proposals" under it names
          the same thing twice and costs the board a screenful. */}
      <section aria-labelledby="board-heading">
        <h2 id="board-heading" className="sr-only">
          Proposals
        </h2>
        <ProposalBoard board={board.data} />
      </section>
    </main>
  );
}
