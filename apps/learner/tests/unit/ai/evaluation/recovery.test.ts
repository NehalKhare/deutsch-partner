import { describe, expect, it } from "vitest";

import { learningEvaluationSchema } from "@dp/domain/evaluation";
import { recoverEvaluation } from "@/lib/ai/evaluation/recovery";

/** A response the schema accepts as it stands. */
function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    estimatedLevel: "A2",
    levelConfidence: 0.6,
    vocabularyUsed: ["fahren", "der Zug"],
    vocabularyWeaknesses: [],
    grammarPatternsUsed: ["dative_prepositions"],
    errors: [
      {
        errorType: "case_dative",
        excerpt: "mit den Zug",
        corrected: "mit dem Zug",
        explanation: "mit takes the dative.",
      },
    ],
    skillEstimates: { fluency: 0.5, comprehension: 0.6, accuracy: 0.4, range: 0.3 },
    masterySignals: [{ lemma: "fahren", direction: "up" }],
    reviewCandidates: ["der Zug"],
    recommendationSignals: ["dative_practice"],
    ...over,
  };
}

describe("what recovery keeps", () => {
  it("returns a valid object unchanged and with nothing to repair", () => {
    const recovered = recoverEvaluation(valid());

    expect(recovered).not.toBeNull();
    expect(recovered?.repairs).toEqual([]);
    expect(learningEvaluationSchema.safeParse(recovered?.evaluation).success).toBe(true);
  });

  it("drops one bad list element and keeps the rest", () => {
    // Forty-nine good observations should not be thrown away to punish one.
    const recovered = recoverEvaluation(
      valid({
        errors: [
          valid().errors as never,
          { errorType: "invented_category", excerpt: "x", corrected: "y", explanation: "z" },
        ].flat(),
      }),
    );

    expect(recovered?.evaluation.errors).toHaveLength(1);
    expect(recovered?.repairs).toContain("errors[1]: dropped");
  });

  it("drops an invalid lemma without losing the valid ones", () => {
    const recovered = recoverEvaluation(
      valid({ vocabularyUsed: ["fahren", "", "der Zug", 42] }),
    );

    expect(recovered?.evaluation.vocabularyUsed).toEqual(["fahren", "der Zug"]);
    expect(recovered?.repairs).toEqual([
      "vocabularyUsed[1]: dropped",
      "vocabularyUsed[3]: dropped",
    ]);
  });

  it("drops a grammar key that is not a slug", () => {
    const recovered = recoverEvaluation(
      valid({ grammarPatternsUsed: ["dative_prepositions", "The Dative Case"] }),
    );

    expect(recovered?.evaluation.grammarPatternsUsed).toEqual(["dative_prepositions"]);
  });

  it("treats a field that should be a list but is not as an empty one", () => {
    const recovered = recoverEvaluation(valid({ reviewCandidates: "der Zug" }));

    expect(recovered?.evaluation.reviewCandidates).toEqual([]);
    expect(recovered?.repairs).toContain("reviewCandidates: not a list");
  });

  it("stops at the cap rather than accepting a model that looped", () => {
    const recovered = recoverEvaluation(
      valid({ vocabularyUsed: Array.from({ length: 200 }, (_v, i) => `wort${i}`) }),
    );

    expect(recovered?.evaluation.vocabularyUsed).toHaveLength(50);
    expect(recovered?.repairs).toContain("vocabularyUsed: truncated past 50");
  });

  it("clamps a score the model overshot", () => {
    // 1.2 fluency means "very high"; refusing to read that is pedantry.
    const recovered = recoverEvaluation(
      valid({
        skillEstimates: { fluency: 1.2, comprehension: -0.1, accuracy: 0.4, range: 0.3 },
      }),
    );

    expect(recovered?.evaluation.skillEstimates.fluency).toBe(1);
    expect(recovered?.evaluation.skillEstimates.comprehension).toBe(0);
    expect(recovered?.repairs).toContain("skillEstimates.fluency: clamped");
  });

  it("treats a missing confidence as no confidence rather than as a guess", () => {
    const { levelConfidence: _dropped, ...rest } = valid();

    const recovered = recoverEvaluation(rest);

    expect(recovered?.evaluation.levelConfidence).toBe(0);
    expect(recovered?.repairs).toContain("levelConfidence: defaulted to zero");
  });

  it("fills a missing list rather than failing on it", () => {
    const { masterySignals: _dropped, ...rest } = valid();

    expect(recoverEvaluation(rest)?.evaluation.masterySignals).toEqual([]);
  });
});

describe("what recovery refuses to invent", () => {
  it("fails without a level, which would move a learner up or down", () => {
    const { estimatedLevel: _dropped, ...rest } = valid();

    expect(recoverEvaluation(rest)).toBeNull();
  });

  it("fails on a level outside the ladder", () => {
    expect(recoverEvaluation(valid({ estimatedLevel: "C1" }))).toBeNull();
  });

  it("fails without skill estimates", () => {
    const { skillEstimates: _dropped, ...rest } = valid();

    expect(recoverEvaluation(rest)).toBeNull();
  });

  it("fails when a skill estimate is not a number at all", () => {
    // Clamping reads an overshoot; there is nothing to read in "high".
    expect(
      recoverEvaluation(
        valid({
          skillEstimates: { fluency: "high", comprehension: 0.6, accuracy: 0.4, range: 0.3 },
        }),
      ),
    ).toBeNull();
  });

  it("fails when a skill estimate is missing entirely", () => {
    expect(
      recoverEvaluation(
        valid({ skillEstimates: { fluency: 0.5, comprehension: 0.6, accuracy: 0.4 } }),
      ),
    ).toBeNull();
  });

  it("fails on NaN, which is a number and means nothing", () => {
    expect(
      recoverEvaluation(
        valid({
          skillEstimates: { fluency: Number.NaN, comprehension: 0.6, accuracy: 0.4, range: 0.3 },
        }),
      ),
    ).toBeNull();
  });

  it("fails on something that is not an object", () => {
    for (const value of [null, undefined, "A2", 42, ["A2"]]) {
      expect(recoverEvaluation(value)).toBeNull();
    }
  });
});

describe("what recovery hands back", () => {
  it("always returns something the schema accepts", () => {
    const messy = valid({
      levelConfidence: 5,
      vocabularyUsed: [1, "fahren", null],
      errors: [{ errorType: "nope" }],
      masterySignals: [{ lemma: "fahren", direction: "sideways" }],
      skillEstimates: { fluency: 2, comprehension: 0.6, accuracy: 0.4, range: 0.3 },
    });

    const recovered = recoverEvaluation(messy);

    expect(recovered).not.toBeNull();
    expect(learningEvaluationSchema.safeParse(recovered?.evaluation).success).toBe(true);
  });

  it("names what it repaired without quoting what was wrong", () => {
    // A repair log that echoes the payload puts model output, and therefore
    // learner text, into an operational record.
    const recovered = recoverEvaluation(
      valid({ vocabularyUsed: ["fahren", "Ich hätte gern einen Kaffee bitte sehr schön ja"] }),
    );

    expect(recovered?.repairs.join(" ")).not.toContain("Kaffee");
  });
});
