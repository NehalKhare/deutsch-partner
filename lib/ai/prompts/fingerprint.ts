/**
 * A stable fingerprint of prompt text.
 *
 * Prompts are immutable once shipped: changing behaviour means a new version,
 * so a trace or a ledger row from last week still says what it ran under. That
 * rule needs teeth, and the teeth are a recorded fingerprint per version. Edit
 * the wording without bumping the version and the lock test fails.
 *
 * FNV-1a rather than a cryptographic hash: this detects an edit, it does not
 * defend against one. A dependency-free function that runs in any environment
 * is worth more here than collision resistance nobody is attacking.
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fingerprint(text: string): string {
  let hash = FNV_OFFSET;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
