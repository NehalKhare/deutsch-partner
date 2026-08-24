import { describe, expect, it } from "vitest";

import { KNOWLEDGE_CONTENT_TYPES } from "@/domain/retrieval";
import { estimateTokens } from "@/lib/ai/prompts/tokens";
import { CHUNK_TARGETS, chunkText } from "@/lib/ingestion/chunk";

const paragraph = (words: number, word = "Wort") =>
  Array.from({ length: words }, () => word).join(" ");

describe("chunking targets", () => {
  it("has a target for every content type", () => {
    for (const type of KNOWLEDGE_CONTENT_TYPES) {
      expect(CHUNK_TARGETS[type].max).toBeGreaterThan(0);
    }
  });

  it("does not use one size for everything", () => {
    const sizes = new Set(KNOWLEDGE_CONTENT_TYPES.map((type) => CHUNK_TARGETS[type].max));

    expect(sizes.size).toBeGreaterThan(1);
  });

  it("gives grammar a larger ceiling than a vocabulary entry", () => {
    // A rule and its examples belong together; a word does not need a page.
    expect(CHUNK_TARGETS.grammar.max).toBeGreaterThan(CHUNK_TARGETS.vocabulary.max);
  });
});

describe("chunking", () => {
  it("keeps a short document as one chunk", () => {
    expect(chunkText("Ein kurzer Absatz über Kaffee.", "grammar")).toEqual([
      "Ein kurzer Absatz über Kaffee.",
    ]);
  });

  it("holds every chunk to the content type's ceiling", () => {
    const body = Array.from({ length: 20 }, () => paragraph(120)).join("\n\n");

    for (const chunk of chunkText(body, "dialogue")) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(CHUNK_TARGETS.dialogue.max);
    }
  });

  it("prefers a paragraph boundary over a size boundary", () => {
    const body = `${paragraph(200, "eins")}\n\n${paragraph(200, "zwei")}`;

    for (const chunk of chunkText(body, "dialogue")) {
      expect(chunk.includes("eins") && chunk.includes("zwei")).toBe(false);
    }
  });

  it("splits inside a paragraph only when the paragraph is too long alone", () => {
    const body = `Erster Satz hier. ${paragraph(600)}. Letzter Satz hier.`;

    expect(chunkText(body, "dialogue").length).toBeGreaterThan(1);
  });

  it("splits a single unbroken sentence rather than exceeding the ceiling", () => {
    for (const chunk of chunkText(paragraph(900), "vocabulary")) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(CHUNK_TARGETS.vocabulary.max);
    }
  });

  it("does not split on an abbreviation's full stop", () => {
    const body = "Man sagt z. B. immer Guten Tag. Das ist die Regel.";

    expect(chunkText(body, "grammar")).toEqual([body]);
  });

  it("treats a horizontal rule as a boundary the author asked for", () => {
    const body = "Erste Einheit.\n\n---\n\nZweite Einheit.";

    expect(chunkText(body, "grammar")).toEqual(["Erste Einheit.", "Zweite Einheit."]);
  });

  it("never merges two author-declared units, however short", () => {
    // This is what keeps two unrelated sentence patterns out of one chunk.
    const body = "Muster eins.\n\n---\n\nMuster zwei.\n\n---\n\nMuster drei.";

    expect(chunkText(body, "sentence_pattern")).toHaveLength(3);
  });

  it("packs short paragraphs together up to the ceiling", () => {
    const body = Array.from({ length: 10 }, (_value, index) => `Absatz ${index}.`).join(
      "\n\n",
    );

    expect(chunkText(body, "grammar")).toHaveLength(1);
  });

  it("folds a tiny trailing fragment back rather than leaving an orphan", () => {
    const chunks = chunkText(`${paragraph(150)}\n\nJa.`, "grammar");

    expect(chunks[chunks.length - 1]).toContain("Ja.");
    expect(chunks[chunks.length - 1].length).toBeGreaterThan(10);
  });

  it("produces nothing for an empty body", () => {
    expect(chunkText("   \n\n  ", "grammar")).toEqual([]);
  });

  it("loses no words", () => {
    const body = Array.from(
      { length: 12 },
      (_value, index) => `Absatz ${index} mit Text.`,
    ).join("\n\n");

    const rejoined = chunkText(body, "vocabulary").join(" ").split(/\s+/u).sort();

    expect(rejoined).toEqual(body.split(/\s+/u).sort());
  });
});
