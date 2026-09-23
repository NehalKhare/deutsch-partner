import Link from "next/link";

import { card, eyebrow, prose } from "@dp/ui/styles";
import {
  stageOwner,
  type BoardProposal,
  type ProductOpsBoard,
} from "@dp/domain/product-ops";
import { boardColumns, workerCommandFor } from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

/**
 * The board.
 *
 * Presentational, and separate from the page for the ordinary reason: the page
 * is two authorization gates and a composition root, and none of that is worth
 * rendering in a test. What is worth testing is that whose move it is can be
 * read off the board — because the whole point of drawing this as a board is
 * deciding what to do next, and a proposal waiting on a person must not look
 * like one waiting on a provider.
 *
 * The column says it. Each card used to repeat it as a sentence of its own —
 * "Approve it to generate a PRD, or reject it." — under a heading that already
 * said "Awaiting you: a proposal or a plan needs a decision". Two lines per
 * card for something the column had said once, which is what pushed five cards
 * past the fold. The one thing the sentence carried that the column does not
 * is a run that has stopped, because a stopped run keeps its proposal status
 * and stays in "In progress"; that survives as one word in the line the card
 * already had.
 */

export function ProposalBoard({
  board,
}: {
  readonly board: ProductOpsBoard;
}) {
  const columns = boardColumns(board);

  if (board.proposals.length === 0) {
    return (
      <p className={prose}>
        Nothing proposed yet. Run a scan and one will appear here for you to
        approve or reject.
      </p>
    );
  }

  return (
    /*
     * Three rows shared by all five columns: the heading, the hint, and the
     * cards. Each column borrows them with `grid-rows-subgrid`, so the first
     * card in every column starts on the same line however many lines that
     * column's hint took. Laid out as five independent flex columns, "A
     * proposal or a plan needs a decision" wrapped to two lines while
     * "Approved and moving" took one, and the card beside it sat a line
     * higher — which reads as a card that is out of place rather than as a
     * heading that is longer.
     */
    <div className="grid gap-4 lg:grid-cols-5 lg:grid-rows-[auto_auto_1fr] lg:gap-x-4 lg:gap-y-2">
      {columns.map((column) => (
        <section
          key={column.key}
          aria-labelledby={`column-${column.key}`}
          className="flex flex-col gap-2 lg:row-span-3 lg:grid lg:grid-rows-subgrid lg:gap-0"
        >
          <h3 id={`column-${column.key}`} className={eyebrow}>
            {column.label} ({column.proposals.length})
          </h3>
          <p className="font-display text-xs text-copy/60">{column.hint}</p>

          <div className="flex flex-col gap-2">
            {column.proposals.length === 0 ? (
              <p className="font-display text-xs text-copy/60">Nothing here.</p>
            ) : null}

            {column.proposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProposalCard({ proposal }: { readonly proposal: BoardProposal }) {
  const owner = stageOwner(proposal.runStage);

  return (
    <article
      className={cn(
        card,
        "flex flex-col gap-2 p-3.5",
        // The one column with anything to do in it is the one that looks like
        // it: the accent is this palette's light source and this is where it
        // belongs.
        owner === "operator" && "border-brand/50",
      )}
    >
      <Link
        href={`/product/${proposal.id}`}
        className="font-display text-sm font-semibold text-copy hover:text-brand"
      >
        {proposal.title}
      </Link>

      <p className="flex flex-wrap items-center gap-2 font-display text-xs text-copy/60">
        <span className="tabular-nums text-copy/70">
          {proposal.priorityScore}/100
        </span>
        <span aria-hidden>·</span>
        <span>{proposal.complexity}</span>
        {proposal.runStatus === "failed" ? (
          // The column cannot say this: the proposal keeps the status it had
          // when the run died, so a stopped run sits in "In progress" looking
          // like a healthy one. It goes in this line rather than on one of its
          // own, so saying it costs the card no height.
          <>
            <span aria-hidden>·</span>
            <span className="font-medium text-ember">Stopped</span>
          </>
        ) : null}
        {proposal.pullRequest?.number ? (
          <>
            <span aria-hidden>·</span>
            {proposal.pullRequest.url ? (
              <a
                href={proposal.pullRequest.url}
                rel="noreferrer nofollow"
                target="_blank"
                className="text-brand underline decoration-brand/40"
              >
                #{proposal.pullRequest.number}
              </a>
            ) : (
              <span>#{proposal.pullRequest.number}</span>
            )}
          </>
        ) : null}
      </p>

      {owner === "worker" ? (
        // Shown rather than run. The stage needs a working tree, and a button
        // here that pretended otherwise would be the dishonest version.
        <code className="overflow-x-auto rounded bg-ground/60 px-2 py-1 font-mono text-[0.7rem] text-copy/60">
          {workerCommandFor(proposal.id)}
        </code>
      ) : null}
    </article>
  );
}
