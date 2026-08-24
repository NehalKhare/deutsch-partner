import { describe, expect, it } from "vitest";

import { retrievalContextSchema, type RetrievalContext } from "@/domain/retrieval";
import { WEIGHTS, rankCandidates, scoreCandidate } from "@/lib/retrieval/scoring";
import type { RetrievalCandidate } from "@/lib/retrieval/scoring";

function learner(over: Partial<RetrievalContext> = {}): RetrievalContext {
  return retrievalContextSchema.parse({
    intent: "grammar",
    cefr: "A2",
    miniLevel: 28,
    ...over,
  });
}

let nextId = 1;

function candidate(over: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    id: nextId++,
    documentId: 1,
    content: "Der Dativ folgt auf mit, nach, bei und seit.",
    cefr: "A2",
    miniLevel: 28,
    topic: null,
    skill: "grammar",
    grammarTarget: null,
    contentType: "grammar",
    difficulty: 3,
    tokenCount: 40,
    similarity: 0.7,
    ...over,
  };
}

describe("the weights", () => {
  it("sum to one, so a score is a fraction of something", () => {
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);

    expect(total).toBeCloseTo(1, 10);
  });

  it("makes similarity the largest single term but not a majority on its own", () => {
    const others = Object.entries(WEIGHTS)
      .filter(([name]) => name !== "similarity")
      .reduce((sum, [, weight]) => sum + weight, 0);

    for (const [name, weight] of Object.entries(WEIGHTS)) {
      if (name === "similarity") continue;
      expect(WEIGHTS.similarity).toBeGreaterThan(weight);
    }
    // The other half is what makes this a tutor rather than a vector store.
    expect(others).toBeCloseTo(0.5, 10);
  });
});

describe("level fit", () => {
  it("scores a chunk at the learner's own level highest", () => {
    const onLevel = scoreCandidate(learner(), candidate());
    const below = scoreCandidate(learner(), candidate({ cefr: "A1", miniLevel: 10 }));
    const above = scoreCandidate(learner(), candidate({ cefr: "B1", miniLevel: 50 }));

    expect(onLevel.breakdown.levelFit).toBeGreaterThan(below.breakdown.levelFit);
    expect(below.breakdown.levelFit).toBeGreaterThan(above.breakdown.levelFit);
  });

  it("treats earlier material as review rather than as noise", () => {
    // A learner at A2 still benefits from A1 content; it is what review is
    // made of.
    expect(
      scoreCandidate(learner(), candidate({ cefr: "A1", miniLevel: 12 })).breakdown
        .levelFit,
    ).toBeGreaterThan(0.3);
  });

  it("penalises material above the learner more than material below", () => {
    const twoBelow = scoreCandidate(learner({ cefr: "B1", miniLevel: 50 }), candidate({ cefr: "A1", miniLevel: 10 }));
    const oneAbove = scoreCandidate(learner({ cefr: "A1", miniLevel: 10 }), candidate({ cefr: "A2", miniLevel: 22 }));

    expect(twoBelow.breakdown.levelFit).toBeGreaterThan(oneAbove.breakdown.levelFit);
  });

  it("penalises a mini-level above the learner more than the same gap below", () => {
    // Held inside one band, so this is the mini-level term alone: material a
    // learner has passed is worth revisiting, material they have not reached
    // is worth very little today however well it matches.
    const behind = scoreCandidate(learner(), candidate({ cefr: "A2", miniLevel: 22 }));
    const ahead = scoreCandidate(learner(), candidate({ cefr: "A2", miniLevel: 34 }));

    expect(behind.breakdown.levelFit).toBeGreaterThan(ahead.breakdown.levelFit);
  });

  it("neither rewards nor punishes a chunk with no level on it", () => {
    const unlabelled = scoreCandidate(
      learner(),
      candidate({ cefr: null, miniLevel: null }),
    );

    expect(unlabelled.breakdown.levelFit).toBeCloseTo(0.5, 10);
  });
});

describe("the three ranking properties the build spec names", () => {
  it("prioritises A1 knowledge for an A1 learner", () => {
    const a1Learner = learner({ cefr: "A1", miniLevel: 8 });
    const ranked = rankCandidates(a1Learner, [
      candidate({ cefr: "B1", miniLevel: 48, similarity: 0.8 }),
      candidate({ cefr: "A2", miniLevel: 24, similarity: 0.78 }),
      candidate({ cefr: "A1", miniLevel: 8, similarity: 0.72 }),
    ]);

    expect(ranked[0].candidate.cefr).toBe("A1");
  });

  it("retrieves dative-related knowledge for an A2 dative question", () => {
    const a2Learner = learner({
      cefr: "A2",
      miniLevel: 26,
      weakGrammarKeys: ["dative_prepositions"],
    });

    const ranked = rankCandidates(a2Learner, [
      candidate({
        content: "Die Akkusativpräpositionen sind durch, für, gegen, ohne, um.",
        grammarTarget: "accusative_prepositions",
        similarity: 0.74,
      }),
      candidate({
        content: "Nach mit, nach, bei, seit, von, zu steht immer der Dativ.",
        grammarTarget: "dative_prepositions",
        similarity: 0.7,
      }),
    ]);

    expect(ranked[0].candidate.grammarTarget).toBe("dative_prepositions");
  });

  it("does not let a broadly similar B1 document outrank relevant A2 knowledge", () => {
    const a2Learner = learner({ cefr: "A2", miniLevel: 26, topic: "travel" });

    const ranked = rankCandidates(a2Learner, [
      // A B1 essay on prepositional government: genuinely about the subject,
      // and genuinely unreadable for this learner.
      candidate({
        cefr: "B1",
        miniLevel: 52,
        contentType: "grammar",
        similarity: 0.86,
      }),
      // The A2 explanation the learner can actually use.
      candidate({
        cefr: "A2",
        miniLevel: 26,
        contentType: "grammar",
        topic: "travel",
        similarity: 0.72,
      }),
    ]);

    expect(ranked[0].candidate.cefr).toBe("A2");
  });

  it("still lets a much better match above the level through", () => {
    // The guard is against a marginal similarity advantage, not against the
    // corpus. If the only thing that answers the question is one band up, a
    // learner is better served by it than by silence.
    const a2Learner = learner({ cefr: "A2", miniLevel: 26 });

    const ranked = rankCandidates(a2Learner, [
      candidate({ cefr: "B1", miniLevel: 40, similarity: 0.95 }),
      candidate({ cefr: "A2", miniLevel: 26, similarity: 0.2 }),
    ]);

    expect(ranked[0].candidate.cefr).toBe("B1");
  });
});

describe("intent", () => {
  it("prefers the content types the intent normally wants", () => {
    const grammar = scoreCandidate(
      learner({ intent: "grammar" }),
      candidate({ contentType: "grammar" }),
    );
    const dialogue = scoreCandidate(
      learner({ intent: "grammar" }),
      candidate({ contentType: "dialogue" }),
    );

    expect(grammar.breakdown.typeFit).toBe(1);
    expect(dialogue.breakdown.typeFit).toBeLessThan(1);
  });

  it("keeps other types eligible rather than removing them", () => {
    // The dialogue that demonstrates a rule is often the better answer.
    expect(
      scoreCandidate(learner({ intent: "grammar" }), candidate({ contentType: "dialogue" }))
        .breakdown.typeFit,
    ).toBeGreaterThan(0);
  });

  it("routes a culture question to cultural content", () => {
    const ranked = rankCandidates(learner({ intent: "culture" }), [
      candidate({ contentType: "grammar", similarity: 0.75 }),
      candidate({ contentType: "culture", similarity: 0.72 }),
    ]);

    expect(ranked[0].candidate.contentType).toBe("culture");
  });
});

describe("what the learner is working on", () => {
  it("promotes a pattern the learner keeps getting wrong", () => {
    const withWeakness = scoreCandidate(
      learner({ weakGrammarKeys: ["two_way_prepositions"] }),
      candidate({ grammarTarget: "two_way_prepositions" }),
    );
    const without = scoreCandidate(
      learner(),
      candidate({ grammarTarget: "two_way_prepositions" }),
    );

    expect(withWeakness.score).toBeGreaterThan(without.score);
  });

  it("ranks a recurring mistake above the current lesson", () => {
    // A recurring mistake is a request for help nobody typed.
    const weakness = scoreCandidate(
      learner({ weakGrammarKeys: ["dative_prepositions"] }),
      candidate({ grammarTarget: "dative_prepositions" }),
    );
    const lesson = scoreCandidate(
      learner({ currentLessonTarget: "dative_prepositions" }),
      candidate({ grammarTarget: "dative_prepositions" }),
    );

    expect(weakness.breakdown.grammarFit).toBeGreaterThan(lesson.breakdown.grammarFit);
  });

  it("matches a recurring error type against the pattern it belongs to", () => {
    const scored = scoreCandidate(
      learner({ recurringErrorTypes: ["case_dative"] }),
      candidate({ grammarTarget: "dative_prepositions" }),
    );

    expect(scored.breakdown.weaknessFit).toBe(1);
  });

  it("does not match an error type against an unrelated pattern", () => {
    const scored = scoreCandidate(
      learner({ recurringErrorTypes: ["case_dative"] }),
      candidate({ grammarTarget: "plural_forms", skill: "vocabulary" }),
    );

    expect(scored.breakdown.weaknessFit).toBe(0);
  });

  it("rewards a chunk containing the words the learner is meant to be using", () => {
    const scored = scoreCandidate(
      learner({ targetVocabularyLemmas: ["Bahnhof", "Zug"] }),
      candidate({ content: "Der Zug fährt vom Bahnhof ab." }),
    );

    expect(scored.breakdown.vocabularyFit).toBeGreaterThan(0);
  });

  it("saturates the vocabulary signal rather than letting a word list win", () => {
    const scored = scoreCandidate(
      learner({ targetVocabularyLemmas: ["a", "b", "c", "d", "e", "f", "g"] }),
      candidate({ content: "a b c d e f g" }),
    );

    expect(scored.breakdown.vocabularyFit).toBe(1);
  });

  it("rewards a chunk on the topic the learner chose", () => {
    const scored = scoreCandidate(
      learner({ topic: "travel" }),
      candidate({ topic: "travel" }),
    );

    expect(scored.breakdown.topicFit).toBe(1);
  });
});

describe("ranking", () => {
  it("orders by score, highest first", () => {
    const ranked = rankCandidates(learner(), [
      candidate({ similarity: 0.2 }),
      candidate({ similarity: 0.9 }),
      candidate({ similarity: 0.5 }),
    ]);

    expect(ranked.map((entry) => entry.candidate.similarity)).toEqual([0.9, 0.5, 0.2]);
  });

  it("breaks a tie the same way every time", () => {
    // A ranking that shuffles under a tie is a ranking nobody can debug.
    const candidates = [candidate({ id: 9 }), candidate({ id: 3 })];

    expect(rankCandidates(learner(), candidates).map((e) => e.candidate.id)).toEqual([
      3, 9,
    ]);
  });

  it("clamps a similarity outside the unit interval", () => {
    expect(scoreCandidate(learner(), candidate({ similarity: 4 })).breakdown.similarity).toBe(
      1,
    );
    expect(
      scoreCandidate(learner(), candidate({ similarity: -1 })).breakdown.similarity,
    ).toBe(0);
  });

  it("keeps the breakdown, so a ranking can be explained", () => {
    const scored = scoreCandidate(learner(), candidate());

    expect(Object.keys(scored.breakdown).sort()).toEqual([
      "grammarFit",
      "levelFit",
      "similarity",
      "topicFit",
      "typeFit",
      "vocabularyFit",
      "weaknessFit",
    ]);
  });
});
