/**
 * The small subset of Markdown a tutor actually writes.
 *
 * Models emphasise the word under discussion and number the things they are
 * about to cover, whatever the prompt asks of them, because that is how they
 * were taught to write. Rendered as plain text that reads as
 * `**das Buch**` and a six-item list flattened into one paragraph — which is
 * exactly the reply a learner cannot skim.
 *
 * So the reply is parsed here into blocks and spans, and rendered as React
 * elements. Parsed rather than pattern-replaced into HTML, deliberately: this
 * is model output, and the one thing it must never be able to do is become
 * markup. Nothing here emits a string of HTML, so there is nothing for
 * dangerouslySetInnerHTML to be tempted by.
 *
 * The subset is small on purpose — emphasis, code, bullets, numbers, headings
 * as emphasis — because everything it does not know stays visible as the
 * characters the model typed, which is a far better failure than a swallowed
 * sentence.
 */

export type Span =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "emphasis"; readonly text: string }
  | { readonly kind: "code"; readonly text: string };

export type Block =
  | { readonly kind: "paragraph"; readonly spans: readonly Span[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly Span[])[];
    };

/** `**strong**`, `*emphasis*`, `` `code` ``. Longest marker first, or `**` reads as two `*`. */
const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|`([^`\n]+)`/g;

const ORDERED = /^\s{0,3}\d{1,2}[.)]\s+(.*)$/u;
const BULLET = /^\s{0,3}[-*•]\s+(.*)$/u;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/u;

/**
 * One line's worth of spans.
 *
 * An unclosed marker matches nothing and therefore survives as itself: a
 * learner reading `2 * 3 = 6` gets the asterisk, not an italic 3.
 */
export function parseSpans(line: string): readonly Span[] {
  const spans: Span[] = [];
  let at = 0;

  for (const match of line.matchAll(INLINE)) {
    const start = match.index;
    if (start > at) spans.push({ kind: "text", text: line.slice(at, start) });

    const [, strong, strongAlt, emphasis, code] = match;
    if (strong !== undefined || strongAlt !== undefined) {
      spans.push({ kind: "strong", text: strong ?? strongAlt! });
    } else if (emphasis !== undefined) {
      spans.push({ kind: "emphasis", text: emphasis });
    } else {
      spans.push({ kind: "code", text: code! });
    }

    at = start + match[0].length;
  }

  if (at < line.length) spans.push({ kind: "text", text: line.slice(at) });

  return spans;
}

/**
 * The reply, as blocks.
 *
 * Runs of plain lines join into a paragraph the way Markdown says they do;
 * a blank line starts a new one. Numbered and bulleted lines gather into a
 * list, and a change of list kind starts a new list — the one thing worse
 * than an unformatted agenda is an agenda whose numbering restarts halfway
 * through for reasons the learner cannot see.
 */
export function parseRichText(text: string): readonly Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: (readonly Span[])[] } | null = null;

  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: parseSpans(paragraph.join(" ")) });
    paragraph = [];
  };

  const closeList = () => {
    if (!list) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of text.replaceAll("\r\n", "\n").split("\n")) {
    const line = raw.trimEnd();

    if (line.trim().length === 0) {
      closeParagraph();
      closeList();
      continue;
    }

    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    const item = ordered ?? bullet;

    if (item) {
      closeParagraph();
      const isOrdered = ordered !== null;
      if (list && list.ordered !== isOrdered) closeList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(parseSpans(item[1]!));
      continue;
    }

    closeList();

    // A heading in a chat bubble is a shout. It reads as what it is — the
    // line that matters — so it becomes an emphasised paragraph of its own.
    const heading = HEADING.exec(line);
    if (heading) {
      closeParagraph();
      blocks.push({
        kind: "paragraph",
        spans: [{ kind: "strong", text: heading[1]! }],
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  closeParagraph();
  closeList();

  return blocks;
}

/**
 * The words alone, for a voice to read.
 *
 * A speech model handed `**das Buch**` may well say the asterisks, and a
 * browser synthesiser stumbles over them; either way the markers are notation
 * for the eye and have no business being pronounced. List markers go too —
 * "one full stop spelling" is not what the number meant.
 */
export function toPlainText(text: string): string {
  return parseRichText(text)
    .map((block) =>
      block.kind === "paragraph"
        ? block.spans.map((span) => span.text).join("")
        : block.items
            .map((item) => item.map((span) => span.text).join(""))
            .join(". "),
    )
    .join("\n")
    .replace(/[ \t]+/gu, " ")
    .trim();
}
