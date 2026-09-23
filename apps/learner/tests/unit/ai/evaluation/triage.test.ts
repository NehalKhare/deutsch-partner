import { describe, expect, it } from "vitest";

import { MIN_EVALUABLE_WORDS, triageMessage } from "@/lib/ai/evaluation/triage";

const skipped = (message: string) => {
  const verdict = triageMessage(message);
  return verdict.evaluate ? null : verdict.reason;
};

describe("what is worth evaluating", () => {
  it("evaluates a sentence a learner composed", () => {
    expect(
      triageMessage("Ich fahre morgen mit dem Zug nach Berlin.").evaluate,
    ).toBe(true);
  });

  it("evaluates a short but real sentence", () => {
    expect(triageMessage("Ich mag Kaffee.").evaluate).toBe(true);
  });

  it("evaluates a question", () => {
    expect(triageMessage("Warum sagt man mit dem Zug?").evaluate).toBe(true);
  });

  it("evaluates a sentence with a mistake in it", () => {
    // The mistake is the point; triage must not filter out the messages
    // evaluation exists to look at.
    expect(triageMessage("Ich habe gegangen nach Hause.").evaluate).toBe(true);
  });
});

describe("what is not", () => {
  it("skips an empty message", () => {
    expect(skipped("")).toBe("empty");
    expect(skipped("   \n  ")).toBe("empty");
  });

  it("skips a message with no letters in it", () => {
    expect(skipped("👍")).toBe("no_letters");
    expect(skipped("!!!")).toBe("no_letters");
    expect(skipped("42")).toBe("no_letters");
  });

  it.each(["Ja", "Nein", "Danke", "Hallo", "Tschüss", "Alles klar", "Genau"])(
    "skips the formulaic reply %s",
    (message) => {
      expect(skipped(message)).toBe("formulaic");
    },
  );

  it("skips a formulaic reply however it is punctuated or cased", () => {
    expect(skipped("JA!")).toBe("formulaic");
    expect(skipped("danke.")).toBe("formulaic");
    expect(skipped("  Alles  klar!! ")).toBe("formulaic");
  });

  it("skips a reply too short to show word order or agreement", () => {
    expect(skipped("Sehr schön")).toBe("too_short");
  });

  it("skips a formulaic phrase even when it is long enough to pass the word count", () => {
    // Five words, and still nothing about what this learner can produce.
    expect(skipped("Wie geht es dir")).toBe("formulaic");
  });
});

describe("where the line sits", () => {
  it("evaluates at the minimum word count and skips below it", () => {
    const words = Array.from({ length: MIN_EVALUABLE_WORDS }, () => "Katze");

    expect(triageMessage(words.join(" ")).evaluate).toBe(true);
    expect(skipped(words.slice(1).join(" "))).toBe("too_short");
  });

  it("does not treat a formulaic word inside a real sentence as formulaic", () => {
    // "danke" alone is a reflex; "danke, dass du mir geholfen hast" is a
    // subordinate clause, and is exactly what evaluation should score.
    expect(triageMessage("Danke, dass du mir geholfen hast.").evaluate).toBe(true);
  });

  it("counts umlauts and eszett as letters", () => {
    expect(triageMessage("Die Straße war schön.").evaluate).toBe(true);
  });

  it("is not confused by an emoji inside a real sentence", () => {
    expect(triageMessage("Ich fahre nach Berlin 🚆 morgen.").evaluate).toBe(true);
  });
});
