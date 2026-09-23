import type { CEFRLevel } from "@dp/domain/cefr";
import type { KnowledgeContentType } from "@dp/domain/retrieval";
import type { RetrievalCandidate } from "@/lib/retrieval/scoring";

/**
 * The two search arms, as the retriever sees them.
 *
 * A port, so the ranking can be tested against a fixed candidate set without a
 * database and the SQL can be tested without a ranking. The filter travels
 * with each call rather than being applied afterwards: both arms take a top-N,
 * and a filter applied to a top-N is a filter that has already lost.
 */

export interface SearchFilter {
  readonly cefr: readonly CEFRLevel[];
  readonly maxMiniLevel: number;
  readonly contentTypes: readonly KnowledgeContentType[] | null;
  readonly limit: number;
}

export interface KnowledgeSearch {
  byVector(
    embedding: readonly number[],
    filter: SearchFilter,
  ): Promise<readonly RetrievalCandidate[]>;
  byText(
    query: string,
    filter: SearchFilter,
  ): Promise<readonly RetrievalCandidate[]>;
}
