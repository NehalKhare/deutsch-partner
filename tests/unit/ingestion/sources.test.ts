import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { KNOWLEDGE_CONTENT_TYPES } from "@/domain/retrieval";
import { prepareDocument } from "@/lib/ingestion/pipeline";
import { sourceDocumentSchema } from "@/lib/ingestion/document";
import { derivedDocuments } from "@/lib/ingestion/sources/derived";
import {
  FrontMatterError,
  documentFromFile,
  fileDocuments,
  parseFrontMatter,
  sourceIdFor,
} from "@/lib/ingestion/sources/files";

const CORPUS = join(process.cwd(), "content");

describe("front matter", () => {
  it("reads scalars", () => {
    const parsed = parseFrontMatter(
      "a.md",
      ["---", "title: Der Dativ", "miniLevel: 20", "draft: false", "topic: null", "---", "", "Body."].join("\n"),
    );

    expect(parsed.attributes).toEqual({
      title: "Der Dativ",
      miniLevel: 20,
      draft: false,
      topic: null,
    });
    expect(parsed.body).toBe("Body.");
  });

  it("unquotes a quoted value, so a colon can appear in a title", () => {
    const parsed = parseFrontMatter("a.md", '---\ntitle: "Dativ: mit, nach, bei"\n---\nx');

    expect(parsed.attributes.title).toBe("Dativ: mit, nach, bei");
  });

  it("ignores comments and blank lines", () => {
    const parsed = parseFrontMatter("a.md", "---\n# a note\n\ntitle: X\n---\nBody.");

    expect(parsed.attributes).toEqual({ title: "X" });
  });

  it("refuses a file with no front matter", () => {
    expect(() => parseFrontMatter("a.md", "Just a body.")).toThrow(FrontMatterError);
  });

  it("refuses an unclosed block", () => {
    expect(() => parseFrontMatter("a.md", "---\ntitle: X\nBody.")).toThrow(/not closed/);
  });

  it("refuses a line that is not a field", () => {
    expect(() => parseFrontMatter("a.md", "---\ntitle X\n---\nBody.")).toThrow(
      /is not "key: value"/,
    );
  });

  it("names the file in the error, because a corpus has many", () => {
    expect(() => parseFrontMatter("content/culture/x.md", "no")).toThrow(
      /content\/culture\/x\.md/,
    );
  });

  it("handles CRLF the same as LF", () => {
    const parsed = parseFrontMatter("a.md", "---\r\ntitle: X\r\n---\r\nBody.");

    expect(parsed.attributes.title).toBe("X");
    expect(parsed.body).toBe("Body.");
  });
});

describe("a file's identity", () => {
  it("is its path inside the corpus, not on this machine", () => {
    expect(sourceIdFor("/home/me/repo/content", "/home/me/repo/content/culture/a.md")).toBe(
      "content/culture/a.md",
    );
  });

  it("carries unknown front-matter fields into metadata rather than dropping them", () => {
    const document = documentFromFile(
      "/root",
      "/root/a.md",
      "---\ntitle: X\ncontentType: culture\nregion: Bayern\n---\nBody.",
    );

    expect(document.metadata).toEqual({ region: "Bayern" });
  });
});

describe("the corpus on disk", () => {
  const documents = fileDocuments(CORPUS);

  it("loads", () => {
    expect(documents.length).toBeGreaterThan(0);
  });

  it("validates every file against the document schema", () => {
    for (const document of documents) {
      const parsed = sourceDocumentSchema.safeParse(document);
      expect(parsed.success, `${document.source}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it("chunks every file into something", () => {
    for (const document of documents) {
      expect(prepareDocument(document).chunks.length, document.source).toBeGreaterThan(0);
    }
  });

  it("returns an empty corpus for a directory that does not exist", () => {
    // The derived sources are the ones this application cannot run without.
    expect(fileDocuments(join(CORPUS, "nope"))).toEqual([]);
  });
});

describe("the derived corpus", () => {
  const documents = derivedDocuments();

  it("covers the curriculum, the grammar and the lexicon", () => {
    expect(documents.length).toBeGreaterThan(200);
  });

  it("validates every document against the schema", () => {
    for (const document of documents) {
      const parsed = sourceDocumentSchema.safeParse(document);
      expect(parsed.success, `${document.source}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it("gives every document a unique source", () => {
    const sources = documents.map((document) => document.source);

    expect(new Set(sources).size).toBe(sources.length);
  });

  it("gives every document a unique content hash", () => {
    // Two documents with the same hash would fight over one row on every run.
    const hashes = documents.map((document) => prepareDocument(document).contentHash);

    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("labels every document with a level retrieval can filter on", () => {
    for (const document of documents) {
      expect(document.cefr, document.source).not.toBeNull();
      expect(document.miniLevel, document.source).not.toBeNull();
    }
  });

  it("licenses everything it produces", () => {
    for (const document of documents) {
      expect(document.license, document.source).toBeTruthy();
    }
  });

  it("keeps each vocabulary word as its own chunk", () => {
    const vocabulary = documents.find((document) =>
      document.source.includes("/vocabulary/1"),
    );

    expect(vocabulary).toBeDefined();
    // Six target words per mini-level, six chunks.
    expect(prepareDocument(vocabulary as never).chunks).toHaveLength(6);
  });
});

describe("the whole corpus", () => {
  const all = [...derivedDocuments(), ...fileDocuments(CORPUS)];

  it("uses content types the database will accept", () => {
    for (const document of all) {
      expect(KNOWLEDGE_CONTENT_TYPES).toContain(document.contentType);
    }
  });

  it("covers most of the dataset types the business objective asks for", () => {
    const present = new Set(all.map((document) => document.contentType));

    for (const required of [
      "curriculum",
      "vocabulary",
      "grammar",
      "culture",
      "dialogue",
      "situation",
      "conversation_function",
      "sentence_pattern",
      "mistake_pattern",
    ] as const) {
      expect([...present], required).toContain(required);
    }
  });
});
