import { OpsSkeleton } from "@/components/operations/ops-skeleton";

/**
 * Its own, so opening a card from the board does not flash the board's title
 * back at the operator on the way to a proposal.
 */
export default function Loading() {
  return <OpsSkeleton title="Proposal" bands={4} />;
}
