import type { KnowledgeContentType } from "@dp/domain/retrieval";
import { estimateTokens } from "@dp/prompts/tokens";

/**
 * Semantic chunking.
 *
 * One chunk size for everything is the default that makes retrieval mediocre
 * in both directions: a grammar explanation cut in half loses the rule from
 * the half that has the examples, and a vocabulary entry padded out to seven
 * hundred tokens buries the word it is about among five others.
 *
 * So the targets come from the content type, and the boundaries come from the
 * text. A paragraph break is a real boundary an author put there; a sentence
 * end is the next best; splitting mid-sentence is a last resort and only
 * happens when a single sentence exceeds the ceiling on its own.
 *
 * A source can override all of this with a horizontal rule, which is how a
 * sentence-pattern or vocabulary file says "these are the units".
 */

export interface ChunkTarget {
  /** Below this, a chunk is merged into the next one where one exists. */
  readonly min: number;
  readonly max: number;
}

/** Token targets from business-objective.md S12. */
export const CHUNK_TARGETS: Readonly<Record<KnowledgeContentType, ChunkTarget>> = {
  grammar: { min: 300, max: 700 },
  mistake_pattern: { min: 200, max: 600 },
  dialogue: { min: 150, max: 500 },
  culture: { min: 250, max: 600 },
  situation: { min: 200, max: 600 },
  conversation_function: { min: 150, max: 450 },
  curriculum: { min: 150, max: 500 },
  // One pattern, or a tightly related group. Merging two unrelated patterns to
  // reach a size target is how a query for one retrieves mostly the other.
  sentence_pattern: { min: 0, max: 250 },
  // One conceptual unit. A word and its senses, not a page of the dictionary.
  vocabulary: { min: 0, max: 200 },
};

/** An explicit unit boundary a source author wrote. */
const HARD_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;

function splitSentences(text: string): string[] {
  // German abbreviations ("z. B.", "usw.") make a naive full-stop split wrong,
  // so a boundary needs a following capital or quotation mark as well.
  const parts = text.split(/(?<=[.!?…])\s+(?=[„"»A-ZÄÖÜ])/u);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function splitWords(text: string, max: number): string[] {
  const words = text.split(/\s+/u);
  const out: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    const candidate = [...current, word].join(" ");
    if (current.length > 0 && estimateTokens(candidate) > max) {
      out.push(current.join(" "));
      current = [word];
    } else {
      current.push(word);
    }
  }

  if (current.length > 0) out.push(current.join(" "));
  return out;
}

/** Paragraph-sized units, already small enough to pack. */
function units(text: string, max: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.flatMap((paragraph) => {
    if (estimateTokens(paragraph) <= max) return [paragraph];

    return splitSentences(paragraph).flatMap((sentence) =>
      estimateTokens(sentence) <= max ? [sentence] : splitWords(sentence, max),
    );
  });
}

/** Greedily fills chunks up to the ceiling without crossing a unit boundary. */
function pack(pieces: readonly string[], target: ChunkTarget): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    if (current === "") {
      current = piece;
      continue;
    }

    const candidate = `${current}\n\n${piece}`;
    if (estimateTokens(candidate) <= target.max) {
      current = candidate;
    } else {
      chunks.push(current);
      current = piece;
    }
  }

  if (current !== "") chunks.push(current);

  // A trailing fragment below the floor is folded back, unless doing so would
  // break the ceiling. A two-sentence orphan retrieves badly on its own.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    const merged = `${previous}\n\n${last}`;

    if (estimateTokens(last) < target.min && estimateTokens(merged) <= target.max) {
      chunks.splice(chunks.length - 2, 2, merged);
    }
  }

  return chunks;
}

export function chunkText(
  body: string,
  contentType: KnowledgeContentType,
): readonly string[] {
  const target = CHUNK_TARGETS[contentType];

  // Author-declared units first. Each is chunked on its own, so a rule never
  // packs two of them together however short they are.
  const sections = body
    .split("\n")
    .reduce<string[][]>(
      (acc, line) => {
        if (HARD_BREAK.test(line)) {
          acc.push([]);
        } else {
          acc[acc.length - 1].push(line);
        }
        return acc;
      },
      [[]],
    )
    .map((lines) => lines.join("\n").trim())
    .filter((section) => section.length > 0);

  return sections.flatMap((section) => pack(units(section, target.max), target));
}
