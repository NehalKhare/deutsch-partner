import { describe, expect, it } from "vitest";

import { clean } from "@/lib/ingestion/clean";
import { normalize } from "@/lib/ingestion/normalize";

describe("cleaning a source", () => {
  it("strips markup", () => {
    expect(clean("<p>Guten <b>Tag</b></p>")).toBe("Guten Tag");
  });

  it("removes a script or style block with its contents", () => {
    expect(clean("<style>p{color:red}</style>Hallo<script>alert(1)</script>")).toBe(
      "Hallo",
    );
  });

  it("removes comments", () => {
    expect(clean("Hallo<!-- ein Kommentar -->Welt")).toBe("HalloWelt");
  });

  it("decodes the entities worth decoding", () => {
    expect(clean("Kaffee &amp; Kuchen &quot;bitte&quot;")).toBe(
      'Kaffee & Kuchen "bitte"',
    );
  });

  it("leaves an entity it does not know rather than guessing", () => {
    expect(clean("&dagger;")).toBe("&dagger;");
  });

  it("normalises line endings", () => {
    expect(clean("eins\r\nzwei\rdrei")).toBe("eins\nzwei\ndrei");
  });

  it("collapses a run of blank lines to one paragraph break", () => {
    expect(clean("eins\n\n\n\n\nzwei")).toBe("eins\n\nzwei");
  });

  it("removes trailing whitespace from every line", () => {
    expect(clean("eins   \nzwei\t\n")).toBe("eins\nzwei");
  });

  it("removes zero-width characters, which are hash churn nobody can see", () => {
    expect(clean("Bahn\u200Bhof\uFEFF")).toBe("Bahnhof");
  });

  it("removes control characters but keeps tabs and newlines", () => {
    expect(clean("a\u0007b\tc\nd")).toBe("ab\tc\nd");
  });

  it("keeps umlauts and eszett exactly as written", () => {
    expect(clean("Straße, Bäcker, Öl, über")).toBe("Straße, Bäcker, Öl, über");
  });

  it("is stable under a second pass", () => {
    const once = clean("<p>Guten  Tag</p>\r\n\r\n\r\nWie geht es?");
    expect(clean(once)).toBe(once);
  });
});

describe("normalising", () => {
  it("composes a decomposed umlaut, so the same word hashes once", () => {
    const decomposed = "Ba\u0308cker";
    const composed = "B\u00E4cker";

    expect(decomposed).not.toBe(composed);
    expect(normalize(decomposed)).toBe(composed);
  });

  it("never folds eszett to ss", () => {
    // Straße and Strasse are different spellings; one of them is wrong in
    // Germany, and both would break a match against the lexicon.
    expect(normalize("Straße")).toBe("Straße");
  });

  it("never folds an umlaut to its digraph", () => {
    expect(normalize("Bäcker über Öl")).toBe("Bäcker über Öl");
  });

  it("leaves case alone, because German capitalises nouns", () => {
    expect(normalize("Der Hund")).toBe("Der Hund");
  });

  it("replaces the several spaces that are not a space", () => {
    expect(normalize("eins\u00A0zwei\u2009drei")).toBe("eins zwei drei");
  });

  it("settles on one dash", () => {
    expect(normalize("eins — zwei ‒ drei")).toBe("eins – zwei – drei");
  });

  it("keeps German quotation marks, which carry meaning in a dialogue", () => {
    expect(normalize("„Guten Tag“ sagte er")).toBe(
      "„Guten Tag“ sagte er",
    );
  });

  it("settles on one apostrophe", () => {
    expect(normalize("wie geht’s")).toBe("wie geht's");
  });

  it("expands the ellipsis character", () => {
    expect(normalize("und dann…")).toBe("und dann...");
  });

  it("collapses runs of spaces without touching newlines", () => {
    expect(normalize("eins   zwei\n\ndrei")).toBe("eins zwei\n\ndrei");
  });

  it("is stable under a second pass", () => {
    const once = normalize("Bäcker — Straße…");
    expect(normalize(once)).toBe(once);
  });
});
