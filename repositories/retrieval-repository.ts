import { z } from "zod";

import { cefrLevelSchema } from "@/domain/cefr";
import { knowledgeContentTypeSchema } from "@/domain/retrieval";
import type { KnowledgeSearch, SearchFilter } from "@/lib/retrieval/search";
import type { RetrievalCandidate } from "@/lib/retrieval/scoring";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { DatabaseClient } from "@/repositories/types";

/**
 * The two search functions, from the retriever's side.
 *
 * Rows are validated on the way out like every other read. A chunk whose
 * content type the domain does not recognise is dropped rather than ranked:
 * it cannot be scored — the intent weighting has no entry for it — and a
 * candidate that cannot be scored would sit at the bottom of every list
 * pretending to be a result.
 */

const chunkRowSchema = z.object({
  id: z.coerce.number().int(),
  document_id: z.coerce.number().int(),
  content: z.string(),
  cefr: cefrLevelSchema.nullable(),
  mini_level: z.coerce.number().int().nullable(),
  topic: z.string().nullable(),
  skill: z.string().nullable(),
  grammar_target: z.string().nullable(),
  content_type: knowledgeContentTypeSchema,
  difficulty: z.coerce.number().int().nullable(),
  token_count: z.coerce.number().int().nullable(),
});

const vectorRowSchema = chunkRowSchema.extend({
  similarity: z.coerce.number(),
});

const lexicalRowSchema = chunkRowSchema.extend({
  rank: z.coerce.number(),
});

type ChunkRow = z.infer<typeof chunkRowSchema>;

function toCandidate(row: ChunkRow, similarity: number): RetrievalCandidate {
  return {
    id: row.id,
    documentId: row.document_id,
    content: row.content,
    cefr: row.cefr,
    miniLevel: row.mini_level,
    topic: row.topic,
    skill: row.skill,
    grammarTarget: row.grammar_target,
    contentType: row.content_type,
    difficulty: row.difficulty,
    tokenCount: row.token_count,
    similarity,
  };
}

/** pgvector's literal form. The same shape ingestion writes. */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

function filterArgs(filter: SearchFilter): Record<string, unknown> {
  return {
    p_cefr: [...filter.cefr],
    p_max_mini_level: filter.maxMiniLevel,
    p_content_types: filter.contentTypes ? [...filter.contentTypes] : null,
    p_limit: filter.limit,
  };
}

export function createKnowledgeSearch(
  client: DatabaseClient,
  logger: Logger = nullLogger,
): KnowledgeSearch {
  /**
   * A failed arm is an empty arm, not a failed retrieval.
   *
   * Hybrid search has two arms so that one of them going down degrades the
   * answer rather than removing it. A learner whose lexical index is briefly
   * unavailable should get a slightly worse reply, not an error.
   */
  function decode<T extends { similarity?: number; rank?: number }>(
    arm: string,
    schema: z.ZodType<T>,
    outcome: { data: unknown; error: { code?: string | null } | null },
    similarityOf: (row: T) => number,
  ): readonly RetrievalCandidate[] {
    if (outcome.error) {
      logger.error("retrieval.arm_failed", {
        arm,
        errorCode: outcome.error.code ?? "unknown",
      });
      return [];
    }

    const parsed = z.array(schema).safeParse(outcome.data ?? []);
    if (!parsed.success) {
      logger.error("retrieval.arm_malformed", {
        arm,
        detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
      });
      return [];
    }

    return parsed.data.map((row) =>
      toCandidate(row as unknown as ChunkRow, similarityOf(row)),
    );
  }

  return {
    async byVector(embedding, filter) {
      const outcome = await client.rpc("search_knowledge_vector", {
        p_embedding: toVectorLiteral(embedding),
        ...filterArgs(filter),
      });

      return decode(
        "vector",
        vectorRowSchema,
        outcome,
        (row) => row.similarity ?? 0,
      );
    },

    async byText(query, filter) {
      const outcome = await client.rpc("search_knowledge_lexical", {
        p_query: query,
        ...filterArgs(filter),
      });

      // ts_rank is corpus-dependent and has no upper bound worth naming, so
      // the absolute value is not used: fusion compares positions, not scores.
      return decode("lexical", lexicalRowSchema, outcome, (row) => row.rank ?? 0);
    },
  };
}
