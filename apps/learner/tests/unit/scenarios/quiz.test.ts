import { describe, expect, it } from "vitest";

import { gradeAnswer, normalizeAnswer } from "@/lib/scenarios/quiz";

describe("normalising an answer", () => {
  it("ignores case, punctuation and stray spacing", () => {
    expect(normalizeAnswer("Um sieben Uhr.")).toBe("um sieben uhr");
    expect(normalizeAnswer("  UM   SIEBEN  UHR!! ")).toBe("um sieben uhr");
  });

  it("keeps umlauts, which distinguish real words", () => {
    expect(normalizeAnswer("Über ihren Urlaub.")).toBe("über ihren urlaub");
  });
});

describe("grading an answer", () => {
  it("accepts the model answer in any spelling of the same words", () => {
    expect(gradeAnswer("um sieben uhr", "Um sieben Uhr.")).toBe("correct");
  });

  it("accepts the substantive core of the model answer", () => {
    expect(gradeAnswer("sieben Uhr", "Um sieben Uhr.")).toBe("correct");
  });

  it("accepts a fuller sentence that contains the model answer", () => {
    expect(gradeAnswer("Sie steht um sieben Uhr auf", "Um sieben Uhr.")).toBe(
      "correct",
    );
  });

  it("sends a different answer to review rather than calling it wrong", () => {
    expect(gradeAnswer("um acht Uhr", "Um sieben Uhr.")).toBe("review");
  });

  it("does not let a single stray letter count as contained", () => {
    expect(gradeAnswer("e", "Der Zug endet in Bremen.")).toBe("review");
  });

  it("sends an empty answer to review", () => {
    expect(gradeAnswer("   ", "Um sieben Uhr.")).toBe("review");
  });
});
