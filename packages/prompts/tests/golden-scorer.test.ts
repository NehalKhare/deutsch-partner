import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  STREAMED_TEXT,
  goldenFileFor,
  matchesExpectation,
  scoreGoldenCase,
  scoreText,
} from "../src/index";

describe("goldenFileFor", () => {
  it("maps an evalSet name to its file", () => {
    expect(goldenFileFor("golden/intent")).toBe("intent.json");
  });
});

describe("matchesExpectation", () => {
  it("accepts an actual that carries everything expected and more", () => {
    const score = matchesExpectation(
      { label: "grammar", confidence: 0.9, extra: true },
      { label: "grammar" },
    );

    expect(score).toEqual({ ok: true, mismatches: [] });
  });

  it("names the path of a wrong value", () => {
    const score = matchesExpectation({ a: { b: 1 } }, { a: { b: 2 } });

    expect(score.ok).toBe(false);
    expect(score.mismatches).toEqual(["$.a.b: expected 2, got 1"]);
  });

  it("matches arrays as a subset, in any order", () => {
    const actual = { errors: [{ errorType: "spelling" }, { errorType: "word_order", excerpt: "x" }] };

    expect(matchesExpectation(actual, { errors: [{ errorType: "word_order" }] }).ok).toBe(true);
    expect(matchesExpectation(actual, { errors: [{ errorType: "gender" }] }).ok).toBe(false);
  });

  it("treats an empty expected array as 'nothing required', not 'must be empty'", () => {
    expect(matchesExpectation({ errors: [{ errorType: "spelling" }] }, { errors: [] }).ok).toBe(true);
  });

  it("checks prose fields with $containsAny, case-insensitively", () => {
    const actual = { summary: "Practised the PERFEKT with haben." };

    expect(matchesExpectation(actual, { summary: { $containsAny: ["perfekt"] } }).ok).toBe(true);
    expect(matchesExpectation(actual, { summary: { $containsAny: ["weil"] } }).ok).toBe(false);
    expect(matchesExpectation({ summary: 3 }, { summary: { $containsAny: ["x"] } }).ok).toBe(false);
  });
});

describe("scoreText", () => {
  it("passes a reply that meets every assertion", () => {
    const score = scoreText("Hallo Tom! Wohnst du in Berlin?", {
      mustContainAny: ["tom"],
      mustNotContain: ["welcome"],
      maxWords: 10,
      endsWithQuestion: true,
    });

    expect(score).toEqual({ ok: true, mismatches: [] });
  });

  it("lists each failed assertion", () => {
    const score = scoreText("Welcome, nice to meet you.", {
      mustContainAny: ["hallo"],
      mustNotContain: ["welcome"],
      maxWords: 3,
      endsWithQuestion: true,
    });

    expect(score.ok).toBe(false);
    expect(score.mismatches).toHaveLength(4);
  });
});

describe("scoreGoldenCase", () => {
  const goldenCase = {
    id: "x",
    input: {},
    reference: { label: "grammar" },
    expect: { label: "grammar" },
  };
  const contract = z.strictObject({ label: z.enum(["grammar", "vocabulary"]) });

  it("rejects an output the contract rejects before looking at its content", () => {
    const score = scoreGoldenCase({ outputContract: contract }, goldenCase, { label: "nope" });

    expect(score.ok).toBe(false);
    expect(score.mismatches[0]).toMatch(/^\$\.label/);
  });

  it("scores a conforming output against the expectation", () => {
    expect(scoreGoldenCase({ outputContract: contract }, goldenCase, { label: "grammar" }).ok).toBe(true);
    expect(scoreGoldenCase({ outputContract: contract }, goldenCase, { label: "vocabulary" }).ok).toBe(false);
  });

  it("judges a streamed entry by text assertions and refuses a non-string", () => {
    const streamed = { ...goldenCase, reference: "Hallo?", expect: { endsWithQuestion: true } };

    expect(scoreGoldenCase({ outputContract: STREAMED_TEXT }, streamed, "Wie geht es dir?").ok).toBe(true);
    expect(scoreGoldenCase({ outputContract: STREAMED_TEXT }, streamed, { text: "x" }).ok).toBe(false);
  });
});
