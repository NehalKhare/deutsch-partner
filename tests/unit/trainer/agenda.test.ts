import { describe, expect, it } from "vitest";

import {
  CULTURE_SLOTS,
  GRAMMAR_SLOTS,
  composeMixedAgenda,
  type AgendaActivity,
} from "@/lib/trainer/agenda";

/**
 * The session's mix, as arithmetic.
 *
 * The property this file holds down is the one the old agenda lost: a learner
 * with a vocabulary backlog still gets grammar and reading in every sitting,
 * because those slots are reserved rather than whatever survives the cut.
 */

const vocab = (count: number): AgendaActivity[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: "recall" as const,
    subject: `Wort${String(index + 1)}`,
    prompt: `What is Wort${String(index + 1)}?`,
  }));

const mistake: AgendaActivity = {
  kind: "correct_the_mistake",
  subject: "The dative case",
  prompt: "keeps using the accusative after mit",
};

const drill: AgendaActivity = {
  kind: "grammar_drill",
  subject: "Dative prepositions",
  prompt: "mit, nach, bei take the dative.",
  patternKey: "dative_prepositions",
};

const news: AgendaActivity = {
  kind: "read_the_news",
  subject: "Nachrichten von heute",
  prompt: "Call fetch_simple_german_news.",
};

describe("what a full backlog cannot crowd out", () => {
  it("keeps grammar and the news in an agenda a backlog would have filled", () => {
    // Twenty words due, eight slots. The old concatenation gave all eight to
    // vocabulary; the mix must not.
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 8,
    });

    expect(agenda).toHaveLength(8);
    expect(agenda.filter((item) => item.kind === "recall")).toHaveLength(5);
    expect(agenda.map((item) => item.kind)).toContain("correct_the_mistake");
    expect(agenda.map((item) => item.kind)).toContain("grammar_drill");
    expect(agenda.at(-1)?.kind).toBe("read_the_news");
  });

  it("runs the lesson arc: vocabulary, then grammar, then the news", () => {
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 8,
    });

    // The order is fixed so a learner always knows where they are in a
    // sitting: words while attention is fresh, then the rules, then reading
    // to close.
    expect(agenda.map((item) => item.kind)).toEqual([
      "recall",
      "recall",
      "recall",
      "recall",
      "recall",
      "correct_the_mistake",
      "grammar_drill",
      "read_the_news",
    ]);
  });

  it("caps the grammar at its slots, mistakes ahead of the syllabus", () => {
    const secondDrill: AgendaActivity = {
      ...drill,
      subject: "sein in the present",
      patternKey: "sein_present",
    };
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill, secondDrill],
      culture: [],
      news,
      size: 8,
    });

    const grammar = agenda.filter(
      (item) => item.kind === "correct_the_mistake" || item.kind === "grammar_drill",
    );
    expect(grammar).toHaveLength(GRAMMAR_SLOTS);
    expect(grammar[0]).toEqual(mistake);
  });
});

describe("what an empty pool hands over", () => {
  it("lets grammar fill the slots vocabulary left empty", () => {
    const agenda = composeMixedAgenda({
      vocabulary: [],
      grammar: [mistake, drill, { ...drill, subject: "sein in the present" }],
      culture: [],
      news,
      size: 8,
    });

    // Nothing due is still a lesson: all the grammar on offer, then reading.
    expect(agenda.map((item) => item.subject)).toEqual([
      "The dative case",
      "Dative prepositions",
      "sein in the present",
      "Nachrichten von heute",
    ]);
  });

  it("gives vocabulary the room grammar does not need", () => {
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [],
      culture: [],
      news,
      size: 8,
    });

    expect(agenda.filter((item) => item.kind === "recall")).toHaveLength(7);
    expect(agenda.at(-1)?.kind).toBe("read_the_news");
  });

  it("is empty once everything including the news is covered", () => {
    expect(
      composeMixedAgenda({
        vocabulary: [],
        grammar: [],
        culture: [],
        news: null,
        size: 8,
      }),
    ).toEqual([]);
  });
});

describe("the size is a promise", () => {
  it("never exceeds it, and spends a tiny agenda on the news first", () => {
    const one = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake],
      culture: [],
      news,
      size: 1,
    });

    expect(one).toEqual([news]);
  });

  it("keeps a small agenda mostly vocabulary rather than mostly rules", () => {
    const three = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 3,
    });

    expect(three.map((item) => item.kind)).toEqual([
      "recall",
      "recall",
      "read_the_news",
    ]);
  });

  it("grows a grammar slot as soon as the room can spare one", () => {
    const four = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 4,
    });

    expect(four.filter((item) => item.kind === "correct_the_mistake")).toHaveLength(1);
    expect(four.at(-1)?.kind).toBe("read_the_news");
  });
});

describe("the culture slot", () => {
  const note: AgendaActivity = {
    kind: "culture_drill",
    subject: "Choice between du and Sie",
    prompt: "Sie for strangers, du for friends and family.",
    patternKey: "du_oder_sie",
  };
  const secondNote: AgendaActivity = {
    ...note,
    subject: "Offer of the du",
    patternKey: "duzen_anbieten",
  };

  it("takes one slot on a full agenda, after grammar and before the news", () => {
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [note],
      news,
      size: 8,
    });

    expect(agenda.map((item) => item.kind)).toEqual([
      "recall",
      "recall",
      "recall",
      "recall",
      "correct_the_mistake",
      "grammar_drill",
      "culture_drill",
      "read_the_news",
    ]);
  });

  it("never exceeds its slots while vocabulary remains", () => {
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [note, secondNote],
      news,
      size: 8,
    });

    expect(agenda.filter((item) => item.kind === "culture_drill")).toHaveLength(
      CULTURE_SLOTS,
    );
  });

  it("gets no slot on a short sitting, which stays mostly vocabulary", () => {
    const three = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [note],
      news,
      size: 3,
    });

    expect(three.map((item) => item.kind)).toEqual([
      "recall",
      "recall",
      "read_the_news",
    ]);
  });

  it("backfills the room vocabulary and grammar left empty", () => {
    const agenda = composeMixedAgenda({
      vocabulary: [],
      grammar: [mistake],
      culture: [note, secondNote],
      news,
      size: 8,
    });

    expect(agenda.map((item) => item.subject)).toEqual([
      "The dative case",
      "Choice between du and Sie",
      "Offer of the du",
      "Nachrichten von heute",
    ]);
  });

  it("changes nothing when the level teaches no culture", () => {
    // The regression assertion for every session before this slot existed:
    // an empty culture pool collapses the arithmetic to what it always was.
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 8,
    });

    expect(agenda.filter((item) => item.kind === "recall")).toHaveLength(5);
    expect(agenda.at(-1)?.kind).toBe("read_the_news");
  });
});

describe("the mix a focus hands in", () => {
  it("gives a grammar focus more of the room without taking all of it", () => {
    const rules = Array.from({ length: 6 }, (_, index) => ({
      kind: "grammar_drill" as const,
      subject: `Rule ${index + 1}`,
      prompt: "teach it",
    }));

    const balanced = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: rules,
      culture: [],
      news,
      size: 8,
    });
    const leaning = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: rules,
      culture: [],
      news,
      size: 8,
      mix: { grammarSlots: 4, grammarEvery: 2 },
    });

    const grammar = (agenda: typeof balanced) =>
      agenda.filter((item) => item.kind === "grammar_drill").length;

    expect(grammar(balanced)).toBe(2);
    expect(grammar(leaning)).toBe(3);
    expect(leaning.filter((item) => item.kind === "recall").length).toBeGreaterThan(0);
    expect(leaning.at(-1)?.kind).toBe("read_the_news");
    expect(leaning).toHaveLength(8);
  });

  it("keeps a single grammar slot for a vocabulary focus, mistakes first", () => {
    const agenda = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 8,
      mix: { grammarSlots: 1, grammarEvery: 4 },
    });

    expect(agenda.filter((item) => item.kind === "recall")).toHaveLength(6);
    expect(agenda.map((item) => item.subject)).toContain("The dative case");
    expect(agenda.map((item) => item.subject)).not.toContain(drill.subject);
  });

  it("is the balanced rule when no mix is given", () => {
    const explicit = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 8,
      mix: { grammarSlots: 2, grammarEvery: 3 },
    });
    const implicit = composeMixedAgenda({
      vocabulary: vocab(20),
      grammar: [mistake, drill],
      culture: [],
      news,
      size: 8,
    });

    expect(explicit).toEqual(implicit);
  });
});
