/**
 * Cleaning a source document.
 *
 * Everything here is about removing what a source carries but a learner should
 * never see, and doing it before the hash is taken. Hashing first would make
 * the same document look changed because an editor rewrote its line endings,
 * and the whole value of the hash is that an unchanged source does no work.
 *
 * Markup is stripped rather than escaped: this text is destined for a prompt,
 * and a retrieved chunk carrying HTML is both wasted tokens and one more thing
 * a model might imitate.
 */

/** The handful worth decoding. Anything else stays literal rather than guessed. */
const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Zero-width and bidirectional marks, plus the byte order mark. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;

/** Control characters. Tab and newline are structure, not noise. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

export function clean(raw: string): string {
  return (
    raw
      // Line endings first, so every later rule sees one shape.
      .replace(/\r\n?/gu, "\n")
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
      .replace(/<[^>]+>/gu, "")
      .replace(/&[#a-z0-9]+;/giu, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
      // Invisible characters are a source of hash churn and of chunks that
      // differ from anything a person can read.
      .replace(INVISIBLE, "")
      .replace(CONTROL, "")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/u, ""))
      .join("\n")
      // A run of blank lines is one paragraph break, never three.
      .replace(/\n{3,}/gu, "\n\n")
      .trim()
  );
}
