import { z } from "zod";

import {
  comprehensionQuestionSchema,
  dialogueContentSchema,
  scenarioKindSchema,
  scenarioLevelSchema,
  scenarioTypeSchema,
  vocabularyGlossSchema,
  type Scenario,
  type ScenarioLevel,
  type ScenarioSummary,
  type ScenarioType,
} from "@/domain/scenario";
import { nonEmptyTextSchema } from "@/domain/primitives";
import type { RepositoryResult } from "@/repositories/errors";
import { decodeInput, decodeRow, decodeRows } from "@/repositories/result";
import type { DatabaseClient } from "@/repositories/types";

/**
 * The scenario corpus, from the application's side.
 *
 * Reads run on the learner's own client, so Row Level Security decides what
 * is reachable — which for this shared corpus is everything, read-only. The
 * vector search goes through the `search_scenarios` database function so
 * type and level filter before ranking, never after.
 */

const SUMMARY_COLUMNS =
  "id, slug, type, kind, title, title_english, description, target_level, " +
  "source, item_index";

/** Slugs are machine-made by ingestion; anything else is rejected unqueried. */
const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9-]+$/u);

/**
 * Row schemas: snake_case columns validated with the domain's own field
 * schemas, then renamed. The transform output *is* the domain type, so
 * nothing downstream re-checks.
 */
const summaryColumns = {
  id: z.coerce.number().int().positive(),
  slug: nonEmptyTextSchema(200),
  type: scenarioTypeSchema,
  kind: scenarioKindSchema,
  title: nonEmptyTextSchema(200),
  title_english: nonEmptyTextSchema(200),
  description: nonEmptyTextSchema(1000),
  target_level: scenarioLevelSchema,
  source: nonEmptyTextSchema(200),
  item_index: z.coerce.number().int().min(0),
};

function toSummary(row: {
  id: number;
  slug: string;
  type: ScenarioType;
  kind: Scenario["kind"];
  title: string;
  title_english: string;
  description: string;
  target_level: ScenarioLevel;
  source: string;
  item_index: number;
  similarity?: number;
}): ScenarioSummary {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    kind: row.kind,
    title: row.title,
    titleEnglish: row.title_english,
    description: row.description,
    targetLevel: row.target_level,
    source: row.source,
    itemIndex: row.item_index,
    ...(row.similarity === undefined ? {} : { similarity: row.similarity }),
  };
}

const summaryRowSchema = z.object(summaryColumns).transform(toSummary);

const searchRowSchema = z
  .object({
    ...summaryColumns,
    // Cosine drift can put an identical vector a hair outside the interval;
    // a perfect match must not read as a malformed row.
    similarity: z.coerce
      .number()
      .transform((value) => Math.min(1, Math.max(0, value))),
  })
  .transform(toSummary);

/** The content column arrives snake_case; the domain speaks camelCase. */
const storedComprehensionContentSchema = z
  .object({
    passage: nonEmptyTextSchema(8000),
    passage_english: z.string().max(8000).nullable().default(null),
    questions: z.array(comprehensionQuestionSchema).min(1).max(20),
  })
  .transform((content) => ({
    passage: content.passage,
    passageEnglish: content.passage_english,
    questions: content.questions,
  }));

const fullRowSchema = z
  .discriminatedUnion("type", [
    z.object({
      ...summaryColumns,
      type: z.literal("dialogue"),
      content: dialogueContentSchema,
      vocabulary: z.array(vocabularyGlossSchema).max(30).default([]),
    }),
    z.object({
      ...summaryColumns,
      type: z.literal("comprehension"),
      content: storedComprehensionContentSchema,
      vocabulary: z.array(vocabularyGlossSchema).max(30).default([]),
    }),
  ])
  .transform(
    (row): Scenario => ({
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      title: row.title,
      titleEnglish: row.title_english,
      description: row.description,
      targetLevel: row.target_level,
      source: row.source,
      itemIndex: row.item_index,
      vocabulary: row.vocabulary,
      ...(row.type === "dialogue"
        ? { type: row.type, content: row.content }
        : { type: row.type, content: row.content }),
    }),
  );

/** pgvector's literal form. The same shape ingestion writes. */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface ScenarioSearchFilter {
  readonly types: readonly ScenarioType[] | null;
  readonly levels: readonly ScenarioLevel[] | null;
  readonly limit: number;
}

export interface ScenarioRepository {
  /** Every scenario, as cards, in corpus order: dialogues first, then A1 → B2. */
  list(): Promise<RepositoryResult<ScenarioSummary[]>>;
  /** One scenario with its full body, by its public slug. */
  getBySlug(slug: unknown): Promise<RepositoryResult<Scenario>>;
  /** Nearest scenarios to a query embedding, filtered before ranking. */
  searchByVector(
    embedding: readonly number[],
    filter: ScenarioSearchFilter,
  ): Promise<RepositoryResult<ScenarioSummary[]>>;
}

export function createScenarioRepository(
  client: DatabaseClient,
): ScenarioRepository {
  return {
    async list() {
      const outcome = await client
        .from("scenarios")
        .select(SUMMARY_COLUMNS)
        .order("source", { ascending: true })
        .order("item_index", { ascending: true });

      return decodeRows(outcome, summaryRowSchema);
    },

    async getBySlug(slug) {
      const input = decodeInput(slug, slugSchema);
      if (!input.ok) return input;

      const outcome = await client
        .from("scenarios")
        .select("*")
        .eq("slug", input.data)
        .single();

      return decodeRow(outcome, fullRowSchema);
    },

    async searchByVector(embedding, filter) {
      const outcome = await client.rpc("search_scenarios", {
        p_embedding: toVectorLiteral(embedding),
        p_types: filter.types ? [...filter.types] : null,
        p_levels: filter.levels ? [...filter.levels] : null,
        p_limit: filter.limit,
      });

      return decodeRows(outcome, searchRowSchema);
    },
  };
}
