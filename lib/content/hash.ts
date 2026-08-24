import { createHash } from "node:crypto";

/**
 * Content hashing for ingestion and for the embedding cache.
 *
 * SHA-256 over the exact text that will be stored or embedded, after cleaning
 * and normalisation. Hashing before normalisation would make the same document
 * look different because a source file changed its line endings, and the whole
 * point of the hash is that re-ingesting unchanged content does nothing.
 *
 * Cryptographic rather than the cheap fingerprint used for prompt versions:
 * this one decides whether text gets re-embedded and whether a chunk is
 * replaced, so an accidental collision would silently serve the wrong content.
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
