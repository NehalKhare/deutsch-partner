import type { RetrievalCandidate } from "@/lib/retrieval/scoring";

/**
 * Combining the two search arms.
 *
 * Vector similarity and lexical rank are not on the same scale and never will
 * be: one is a cosine, the other is a corpus-dependent ts_rank whose absolute
 * value means nothing on its own. Normalising them against each other would be
 * inventing a comparison. Reciprocal rank fusion compares the only thing the
 * two arms genuinely agree on — the order they put things in.
 *
 * A chunk found by both arms is the strong signal, and this is what makes it
 * one: it scores in both lists and the contributions add.
 */

export interface RankedList {
  readonly results: readonly RetrievalCandidate[];
  /** How much this arm counts. Both arms are equal until evaluation says otherwise. */
  readonly weight: number;
}

/**
 * The damping constant from the original formulation. Large enough that the
 * difference between rank 1 and rank 2 does not swamp the difference between
 * appearing in one list and appearing in both.
 */
export const RRF_K = 60;

export function fuse(lists: readonly RankedList[]): readonly RetrievalCandidate[] {
  const scores = new Map<number, number>();
  const byId = new Map<number, RetrievalCandidate>();

  for (const list of lists) {
    for (const [index, candidate] of list.results.entries()) {
      const contribution = list.weight / (RRF_K + index + 1);
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + contribution);

      // Whichever arm saw it first wins the row itself; the arms return the
      // same columns, so only the similarity differs and that is replaced.
      if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }
  }

  if (scores.size === 0) return [];

  // Rescaled to 0..1 so the downstream weights mean what they say. The best
  // fused candidate is 1 by construction, which is a statement about the
  // candidate set rather than about the corpus — and that is the right frame,
  // because the scoring that follows is choosing between these candidates.
  const best = Math.max(...scores.values());

  return [...scores.entries()]
    .sort(([idA, a], [idB, b]) => b - a || idA - idB)
    .map(([id, score]) => ({
      ...(byId.get(id) as RetrievalCandidate),
      similarity: score / best,
    }));
}
