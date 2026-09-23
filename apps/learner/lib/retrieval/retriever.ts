import type { CEFRLevel } from "@dp/domain/cefr";
import { retrievalContextSchema, type RetrievalContext } from "@dp/domain/retrieval";
import type { EmbeddingContext } from "@dp/gateway/embeddings";
import type { EmbeddingService } from "@dp/gateway/embedding-service";
import {
  gatewayFail,
  gatewayOk,
  type GatewayResult,
} from "@dp/gateway/errors";
import { truncateToTokens } from "@dp/prompts/tokens";
import { candidateFilter } from "@/lib/retrieval/filters";
import { fuse } from "@/lib/retrieval/fusion";
import { rankCandidates, type ScoredCandidate } from "@/lib/retrieval/scoring";
import type { KnowledgeSearch, SearchFilter } from "@/lib/retrieval/search";
import { nullLogger, type Logger } from "@dp/observability/logger";

/**
 * The German learning retriever.
 *
 * Vector plus metadata filtering, with a lexical arm alongside it, fused and
 * then ranked for the learner who asked. Deliberately no reranker and no query
 * rewriting: the routing document puts both behind evidence that they help,
 * and neither has been measured yet.
 */

/** Small, per the context-budget discipline: four to six chunks, not twenty. */
export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 12;

/** How many each arm returns before fusion. Enough overlap to be worth fusing. */
const CANDIDATE_POOL = 24;

/** Per-chunk cap, so one long chunk cannot eat the retrieval budget. */
export const MAX_CHUNK_TOKENS = 220;

/**
 * A learner's message can be long; the part that carries the question is
 * almost always the start of it, and an embedding of five hundred tokens of
 * chat is an embedding of nothing in particular.
 */
const MAX_QUERY_TOKENS = 120;

export interface RetrievedChunk {
  readonly id: number;
  readonly documentId: number;
  readonly content: string;
  readonly score: number;
  readonly cefr: CEFRLevel | null;
  readonly miniLevel: number | null;
  readonly contentType: string;
  readonly grammarTarget: string | null;
}

export interface RetrievalResult {
  readonly chunks: readonly RetrievedChunk[];
  readonly considered: number;
  readonly costEur: number;
  /** Kept for tracing: why these, in this order. */
  readonly ranked: readonly ScoredCandidate[];
}

export interface RetrieverDeps {
  readonly search: KnowledgeSearch;
  readonly embeddings: EmbeddingService;
  readonly logger?: Logger;
}

export interface RetrieveOptions {
  readonly topK?: number;
  readonly context?: EmbeddingContext;
}

export interface GermanLearningRetriever {
  retrieve(
    message: string,
    learner: unknown,
    options?: RetrieveOptions,
  ): Promise<GatewayResult<RetrievalResult>>;
}

/**
 * The lexical query.
 *
 * The vector arm embeds the message alone, because that is what the chunk text
 * is comparable to. The lexical arm gets the learner's context appended: the
 * grammar they are working on and the words they are supposed to be using are
 * literal terms that appear in the corpus, and a keyword search is exactly the
 * arm that can use them.
 */
export function lexicalQuery(message: string, context: RetrievalContext): string {
  const expansions = [
    context.currentLessonTarget,
    ...context.weakGrammarKeys.map((key) => key.replace(/_/gu, " ")),
    ...context.targetVocabularyLemmas.slice(0, 6),
  ].filter((term): term is string => typeof term === "string" && term.length > 0);

  return [message, ...expansions].join(" ");
}

function toFilter(context: RetrievalContext): SearchFilter {
  const filter = candidateFilter(context);

  return {
    cefr: filter.cefr,
    maxMiniLevel: filter.maxMiniLevel,
    contentTypes: filter.contentTypes,
    limit: CANDIDATE_POOL,
  };
}

export function createRetriever(deps: RetrieverDeps): GermanLearningRetriever {
  const logger = deps.logger ?? nullLogger;

  return {
    async retrieve(message, learner, options = {}) {
      const parsed = retrievalContextSchema.safeParse(learner);
      if (!parsed.success) {
        return gatewayFail(
          "invalid_spec",
          parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
        );
      }

      const context = parsed.data;
      const topK = Math.max(1, Math.min(options.topK ?? DEFAULT_TOP_K, MAX_TOP_K));

      // Nothing in a pedagogical corpus answers a question about today. The
      // caller routes those elsewhere rather than being handed stale content
      // presented as current.
      if (context.intent === "web") {
        return gatewayOk({ chunks: [], considered: 0, costEur: 0, ranked: [] });
      }

      const trimmed = truncateToTokens(message.trim(), MAX_QUERY_TOKENS);
      if (trimmed.length === 0) {
        return gatewayOk({ chunks: [], considered: 0, costEur: 0, ranked: [] });
      }

      const filter = toFilter(context);

      const embedded = await deps.embeddings.embed(
        [trimmed],
        options.context ?? { requestId: null },
      );
      if (!embedded.ok) return embedded;

      // Both arms in parallel: they are independent queries, and the lexical
      // one is fast enough that waiting for it in series would be waste.
      const [vector, lexical] = await Promise.all([
        deps.search.byVector(embedded.data.embedded[0].embedding, filter),
        deps.search.byText(lexicalQuery(trimmed, context), filter),
      ]);

      const fused = fuse([
        { results: vector, weight: 1 },
        { results: lexical, weight: 1 },
      ]);

      const ranked = rankCandidates(context, fused);

      logger.debug("retrieval.completed", {
        intent: context.intent,
        cefr: context.cefr,
        vectorHits: vector.length,
        lexicalHits: lexical.length,
        considered: fused.length,
        returned: Math.min(topK, ranked.length),
      });

      return gatewayOk({
        chunks: ranked.slice(0, topK).map((scored) => ({
          id: scored.candidate.id,
          documentId: scored.candidate.documentId,
          // Capped here rather than in the prompt builder, so the budget the
          // caller is given is the budget it actually spends.
          content: truncateToTokens(scored.candidate.content, MAX_CHUNK_TOKENS),
          score: scored.score,
          cefr: scored.candidate.cefr,
          miniLevel: scored.candidate.miniLevel,
          contentType: scored.candidate.contentType,
          grammarTarget: scored.candidate.grammarTarget,
        })),
        considered: fused.length,
        costEur: embedded.data.costEur,
        ranked,
      });
    },
  };
}
