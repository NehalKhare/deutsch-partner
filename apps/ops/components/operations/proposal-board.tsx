import Link from "next/link";

import { card, eyebrow, prose } from "@dp/ui/styles";
import {
  stageOwner,
  type BoardProposal,
  type ProductOpsBoard,
} from "@dp/domain/product-ops";
import {
  boardColumns,
  nextStep,
  workerCommandFor,
} from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

/**
 * The board.
 *
 * Presentational, and separate from the page for the ordinary reason: the page
 * is two authorization gates and a composition root, and none of that is worth
 * rendering in a test. What is worth testing is that every card says whose
 * move it is — because the whole point of drawing this as a board is deciding
 * what to do next, and a proposal waiting on a person must not look like one
 * waiting on a provider.
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
    <div className="grid gap-4 lg:grid-cols-5">
      {columns.map((column) => (
        <section
          key={column.key}
          aria-labelledby={`column-${column.key}`}
          className="flex flex-col gap-2"
        >
          <h3 id={`column-${column.key}`} className={eyebrow}>
            {column.label} ({column.proposals.length})
          </h3>
          <p className="font-display text-xs text-copy/35">{column.hint}</p>

          {column.proposals.length === 0 ? (
            <p className="font-display text-xs text-copy/30">Nothing here.</p>
          ) : null}

          {column.proposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
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
        owner === "operator" && "border-apricot/50",
      )}
    >
      <Link
        href={`/product/${proposal.id}`}
        className="font-display text-sm font-semibold text-copy hover:text-apricot"
      >
        {proposal.title}
      </Link>

      <p className="flex flex-wrap items-center gap-2 font-display text-xs text-copy/45">
        <span className="tabular-nums text-copy/70">
          {proposal.priorityScore}/100
        </span>
        <span aria-hidden>·</span>
        <span>{proposal.complexity}</span>
        {proposal.pullRequest?.number ? (
          <>
            <span aria-hidden>·</span>
            {proposal.pullRequest.url ? (
              <a
                href={proposal.pullRequest.url}
                rel="noreferrer nofollow"
                target="_blank"
                className="text-apricot underline decoration-apricot/40"
              >
                #{proposal.pullRequest.number}
              </a>
            ) : (
              <span>#{proposal.pullRequest.number}</span>
            )}
          </>
        ) : null}
      </p>

      <p className="font-display text-xs text-copy/60">{nextStep(proposal)}</p>

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
