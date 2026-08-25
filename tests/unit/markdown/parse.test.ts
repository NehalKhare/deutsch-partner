import { describe, expect, it } from "vitest";

import { parseRichText, parseSpans, toPlainText } from "@/lib/markdown/parse";

/**
 * The subset of Markdown a tutor writes.
 *
 * The cases that matter are the ones a real reply produced: the word under
 * discussion in bold, an agenda numbered on its own lines, and — the reason
 * this is a parser rather than a few replacements — arithmetic and stray
 * asterisks that must survive as themselves.
 */

const text = (content: string) => ({ kind: "text" as const, text: content });

describe("spans in a line", () => {
  it("reads bold and italic", () => {
    expect(parseSpans("Ja, super: **das Buch**.")).toEqual([
      text("Ja, super: "),
      { kind: "strong", text: "das Buch" },
      text("."),
    ]);
    expect(parseSpans("mini-level 4: *Der, die, das*")).toEqual([
      text("mini-level 4: "),
      { kind: "emphasis", text: "Der, die, das" },
    ]);
  });

  it("reads bold before italic, so ** is not two *", () => {
    expect(parseSpans("**A1 level**")).toEqual([{ kind: "strong", text: "A1 level" }]);
  });

  it("leaves an unclosed marker as the characters it is", () => {
    // A learner reading about multiplication should see the asterisk.
    expect(parseSpans("2 * 3 = 6")).toEqual([text("2 * 3 = 6")]);
    expect(parseSpans("**not closed")).toEqual([text("**not closed")]);
  });

  it("reads code as code", () => {
    expect(parseSpans("say `Guten Tag`")).toEqual([
      text("say "),
      { kind: "code", text: "Guten Tag" },
    ]);
  });
});

describe("blocks in a reply", () => {
  it("turns a numbered agenda into a list instead of a paragraph", () => {
    const blocks = parseRichText(
      "Here is what we will cover:\n1. spelling\n2. article\n3. word_order",
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      spans: [text("Here is what we will cover:")],
    });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
    if (blocks[1]?.kind !== "list") throw new Error("expected a list");
    expect(blocks[1].items).toHaveLength(3);
    expect(blocks[1].items[0]).toEqual([text("spelling")]);
  });

  it("keeps bullets and numbers as different lists", () => {
    const blocks = parseRichText("- eins\n- zwei\n1. drei");

    expect(blocks.map((block) => block.kind === "list" && block.ordered)).toEqual([
      false,
      true,
    ]);
  });

  it("joins a run of plain lines into one paragraph and splits on a blank one", () => {
    const blocks = parseRichText("Ja, genau.\nSuper gemacht!\n\nNoch eins?");

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      spans: [text("Ja, genau. Super gemacht!")],
    });
  });

  it("renders a heading as the line that matters, not a shout", () => {
    expect(parseRichText("## Deine Aufgabe")).toEqual([
      { kind: "paragraph", spans: [{ kind: "strong", text: "Deine Aufgabe" }] },
    ]);
  });

  it("has nothing to say about nothing", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText("\n\n  \n")).toEqual([]);
  });
});

describe("what a voice is given", () => {
  it("drops the notation and keeps the words", () => {
    expect(toPlainText("Ja, super: **das Buch**. Noch eins: ___ Tasche?")).toBe(
      "Ja, super: das Buch. Noch eins: ___ Tasche?",
    );
  });

  it("reads a list as sentences rather than as numbers", () => {
    // "one full stop spelling" is not what the number meant.
    expect(toPlainText("1. spelling\n2. article")).toBe("spelling. article");
  });

  it("says the emphasised word once, without its asterisks", () => {
    expect(toPlainText("mini-level 4: *Der, die, das*")).toBe(
      "mini-level 4: Der, die, das",
    );
  });
});
