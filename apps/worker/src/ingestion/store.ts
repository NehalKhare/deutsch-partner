import type { SourceDocument } from "./document";

/**
 * What ingestion needs from the database, and nothing more.
 *
 * A port rather than a repository import, so the pipeline's tests run the real
 * pipeline against an in-memory store and the database tests exercise the SQL
 * on its own. The two meet in the adapter.
 */

export interface StoredDocument {
  readonly id: number;
  /** Every chunk hash currently stored, so an unchanged document does no work. */
  readonly chunkHashes: readonly string[];
}

export interface ChunkRecord {
  readonly chunkIndex: number;
  readonly content: string;
  readonly chunkHash: string;
  readonly tokenCount: number;
  readonly cefr: string | null;
  readonly miniLevel: number | null;
  readonly topic: string | null;
  readonly skill: string | null;
  readonly grammarTarget: string | null;
  readonly contentType: string;
  readonly difficulty: number | null;
  /**
   * Absent when the chunk is unchanged and the stored vector still stands.
   * The write keeps the existing one rather than nulling it.
   */
  readonly embedding: readonly number[] | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface SaveResult {
  readonly documentId: number;
  readonly created: boolean;
  readonly chunksWritten: number;
  readonly chunksRemoved: number;
}

export interface IngestionStore {
  findDocument(contentHash: string): Promise<StoredDocument | null>;
  save(
    document: SourceDocument,
    contentHash: string,
    chunks: readonly ChunkRecord[],
  ): Promise<SaveResult>;
}
