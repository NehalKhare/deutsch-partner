import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  learningEvaluationSchema,
  parseModelJson,
} from "../src/evaluation";

const evaluation = {
  estimatedLevel: "A2",
  levelConfidence: 0.6,
  vocabularyUsed: ["gehen", "Kino"],
  vocabularyWeaknesses: ["trotzdem"],
  grammarPatternsUsed: ["main_clause_word_order"],
  errors: [
    {
      errorType: "word_order",
      excerpt: "Ich morgen gehe",
      corrected: "Ich gehe morgen",
      explanation: "Verb second in a main clause.",
    },
  ],
  skillEstimates: {
    fluency: 0.5,
    comprehension: 0.6,
    accuracy: 0.4,
    range: 0.3,
  },
  masterySignals: [{ lemma: "gehen", direction: "up" }],
  reviewCandidates: ["trotzdem"],
  recommendationSignals: ["practice_word_order"],
};

describe("learningEvaluationSchema", () => {
  it("accepts a well-formed evaluation", () => {
    expect(learningEvaluationSchema.parse(evaluation).estimatedLevel).toBe("A2");
  });

  it("rejects an invalid CEFR estimate", () => {
    expect(
      learningEvaluationSchema.safeParse({
        ...evaluation,
        estimatedLevel: "C2",
      }).success,
    ).toBe(false);
  });

  it("rejects an error type outside the taxonomy", () => {
    expect(
      learningEvaluationSchema.safeParse({
        ...evaluation,
        errors: [{ ...evaluation.errors[0], errorType: "bad_vibes" }],
      }).success,
    ).toBe(false);
  });

  it.each(["fluency", "comprehension", "accuracy", "range"])(
    "rejects a %s estimate outside the unit interval",
    (skill) => {
      expect(
        learningEvaluationSchema.safeParse({
          ...evaluation,
          skillEstimates: { ...evaluation.skillEstimates, [skill]: 1.4 },
        }).success,
      ).toBe(false);
    },
  );

  it("rejects a mastery signal with an unknown direction", () => {
    expect(
      learningEvaluationSchema.safeParse({
        ...evaluation,
        masterySignals: [{ lemma: "gehen", direction: "sideways" }],
      }).success,
    ).toBe(false);
  });

  it("accepts an evaluation that found nothing, which is a valid outcome", () => {
    expect(
      learningEvaluationSchema.safeParse({
        ...evaluation,
        vocabularyUsed: [],
        vocabularyWeaknesses: [],
        grammarPatternsUsed: [],
        errors: [],
        masterySignals: [],
        reviewCandidates: [],
        recommendationSignals: [],
      }).success,
    ).toBe(true);
  });

  it("caps list sizes so a runaway model response cannot flood the database", () => {
    expect(
      learningEvaluationSchema.safeParse({
        ...evaluation,
        vocabularyUsed: Array.from({ length: 500 }, (_, i) => `wort${i}`),
      }).success,
    ).toBe(false);
  });
});

describe("parseModelJson", () => {
  const schema = z.object({ answer: z.string() });

  it("parses plain JSON", () => {
    const result = parseModelJson('{"answer":"ja"}', schema);

    expect(result).toEqual({ ok: true, data: { answer: "ja" } });
  });

  it("parses JSON wrapped in a fenced code block", () => {
    const result = parseModelJson(
      '```json\n{"answer":"ja"}\n```',
      schema,
    );

    expect(result.ok && result.data.answer).toBe("ja");
  });

  it("parses JSON wrapped in an unlabelled fence", () => {
    expect(parseModelJson('```\n{"answer":"ja"}\n```', schema).ok).toBe(true);
  });

  it("parses JSON surrounded by conversational prose", () => {
    const result = parseModelJson(
      'Sure! Here is the result:\n{"answer":"ja"}\nHope that helps.',
      schema,
    );

    expect(result.ok && result.data.answer).toBe("ja");
  });

  it("fails on syntactically invalid JSON", () => {
    const result = parseModelJson('{"answer": }', schema);

    expect(result).toMatchObject({ ok: false, reason: "invalid_json" });
  });

  it("fails on output containing no JSON at all", () => {
    expect(parseModelJson("I cannot help with that.", schema)).toMatchObject({
      ok: false,
      reason: "invalid_json",
    });
  });

  it("fails when valid JSON does not satisfy the schema", () => {
    const result = parseModelJson('{"answer":42}', schema);

    expect(result).toMatchObject({ ok: false, reason: "schema_mismatch" });
  });

  it("reports schema issues without echoing the raw model output", () => {
    const result = parseModelJson(
      '{"answer":"leaked-secret-value"}',
      z.object({ answer: z.number() }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(JSON.stringify(result.issues)).not.toContain("leaked-secret-value");
  });

  it("rejects a non-object JSON payload", () => {
    expect(parseModelJson("[1,2,3]", schema).ok).toBe(false);
  });

  it("refuses oversized output rather than parsing it", () => {
    const huge = `{"answer":"${"a".repeat(200_000)}"}`;

    expect(parseModelJson(huge, schema)).toMatchObject({
      ok: false,
      reason: "too_large",
    });
  });

  it("validates a full evaluation coming back as fenced JSON", () => {
    const raw = "```json\n" + JSON.stringify(evaluation) + "\n```";

    expect(parseModelJson(raw, learningEvaluationSchema).ok).toBe(true);
  });
});
