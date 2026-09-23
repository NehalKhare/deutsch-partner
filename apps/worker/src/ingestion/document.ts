import { z } from "zod";

import { cefrLevelSchema, miniLevelSchema } from "@dp/domain/cefr";
import { nonEmptyTextSchema } from "@dp/domain/primitives";
import { knowledgeContentTypeSchema } from "@dp/domain/retrieval";
import { clean } from "./clean";
import { normalize } from "./normalize";
import { contentHash } from "@dp/gateway/content-hash";

/**
 * A document as a source hands it over, and what ingestion turns it into.
 *
 * Metadata is validated here rather than trusted, because retrieval filters on
 * it: a chunk labelled B1 when it is A1 material does not fail, it quietly
 * reaches the wrong learner. Everything the retrieval filters use — level,
 * topic, skill, grammar target, content type — is either a closed set or a
 * bounded string, and nothing is inferred silently.
 */

/** The whole corpus fits comfortably; a source this large is a loading bug. */
const MAX_BODY_LENGTH = 200_000;

export const sourceDocumentSchema = z.strictObject({
  /** Where it came from. Part of the identity, so two sources may agree. */
  source: nonEmptyTextSchema(200),
  title: nonEmptyTextSchema(300),
  contentType: knowledgeContentTypeSchema,
  language: z.enum(["de", "en"]).default("de"),
  cefr: cefrLevelSchema.nullable().default(null),
  miniLevel: miniLevelSchema.nullable().default(null),
  topic: nonEmptyTextSchema(64).nullable().default(null),
  skill: nonEmptyTextSchema(64).nullable().default(null),
  grammarTarget: nonEmptyTextSchema(64).nullable().default(null),
  difficulty: z.number().int().min(1).max(5).nullable().default(null),
  license: nonEmptyTextSchema(120).nullable().default(null),
  attribution: nonEmptyTextSchema(300).nullable().default(null),
  body: nonEmptyTextSchema(MAX_BODY_LENGTH),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type SourceDocumentInput = z.input<typeof sourceDocumentSchema>;

export interface PreparedChunk {
  readonly index: number;
  readonly content: string;
  readonly chunkHash: string;
  readonly tokenCount: number;
}

export interface PreparedDocument {
  readonly document: SourceDocument;
  /** Cleaned and normalised. What is hashed, chunked and eventually stored. */
  readonly body: string;
  readonly contentHash: string;
  readonly chunks: readonly PreparedChunk[];
}

/**
 * The document's identity.
 *
 * Source plus cleaned body, and deliberately not the title or the metadata: a
 * corrected title should update the row it belongs to, not create a second
 * document that answers the same questions slightly differently. Two sources
 * carrying the same text stay two documents, because attribution differs and
 * so does what a learner should be told about where an answer came from.
 */
export function documentHash(source: string, body: string): string {
  // A separator that cannot occur in either half, so a source ending in a
  // newline and a body beginning with one cannot hash the same as the pair
  // the other way round.
  return contentHash(`${source}\u0000${body}`);
}

export function prepareBody(raw: string): string {
  return normalize(clean(raw));
}
