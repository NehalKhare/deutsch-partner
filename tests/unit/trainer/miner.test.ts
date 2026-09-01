import { describe, expect, it } from "vitest";

import type { AnswerAnalysis } from "@/domain/trainer-analysis";
import { createTurnBudget } from "@/lib/ai/gateway/budgeter";
import { gatewayOk } from "@/lib/ai/gateway/errors";
import type { ModelGateway } from "@/lib/ai/gateway/gateway";
import {
  foldFindings,
  mineSession,
  sessionKeyFor,
  type MineDeps,
} from "@/lib/trainer/miner";

/**
 * The post-response units, against hand-rolled fakes. The properties: findings
 * become observations against the closed taxonomy and degrade item by item, a
 * duplicated completion turn mines nothing twice, only catalogue words are
 * ever written, the engine alone moves the schedule, and every failure —
 * refused budget, dead provider, unusable output — writes nothing at all.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "33333333-3333-4333-8333-333333333333";

const ok = <T,>(data: T) => ({ ok: true as const, data });

const ANALYSIS: AnswerAnalysis = {
  verdict: "partially_correct",
  findings: [
    {
      errorType: "case_dative",
      excerpt: "mit der Zug",
      corrected: "mit dem Zug",
      note: 'After "mit" the noun takes the dative: "mit dem Zug".',
    },
    {
      errorType: "word_order",
      excerpt: "weil ich bin müde",
      corrected: "weil ich müde bin",
      note: 'In a "weil" clause the verb goes last.',
    },
  ],
  anglicisms: [{ excerpt: "Ich bin kalt", idiomatic: "Mir ist kalt" }],
  vocabularyElevation: [],
  register: {
    verdict: "too_informal",
    note: 'Used "du" with a stranger at a counter; that exchange takes "Sie".',
  },
};

describe("foldFindings", () => {
  it("turns findings, anglicisms and a register slip into observations", async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const errors = {
      record: async (observation: Record<string, unknown>) => {
        recorded.push(observation);
        return ok("id");
      },
    } as never;

    await foldFindings({ errors, learnerId: LEARNER, requestId: REQUEST }, ANALYSIS);

    expect(recorded).toHaveLength(4);
    expect(recorded.map((observation) => observation.errorType)).toEqual([
      "case_dative",
      "word_order",
      "vocabulary_choice",
      "register_formality",
    ]);
    // The anglicism's pattern teaches the idiomatic form in English.
    expect(recorded[2]?.pattern).toContain("Mir ist kalt");
    expect(recorded[2]?.utterance).toBe("Ich bin kalt");
  });

  it("keeps folding when one write fails", async () => {
    const recorded: unknown[] = [];
    let first = true;
    const errors = {
      record: async (observation: unknown) => {
        if (first) {
          first = false;
          throw new Error("boom");
        }
        recorded.push(observation);
        return ok("id");
      },
    } as never;

    await foldFindings({ errors, learnerId: LEARNER, requestId: REQUEST }, ANALYSIS);

    expect(recorded).toHaveLength(3);
  });

  it("writes nothing for a clean answer", async () => {
    const recorded: unknown[] = [];
    const errors = {
      record: async (observation: unknown) => {
        recorded.push(observation);
        return ok("id");
      },
    } as never;

    await foldFindings(
      { errors, learnerId: LEARNER, requestId: REQUEST },
      {
        verdict: "correct",
        findings: [],
        anglicisms: [],
        vocabularyElevation: [],
        register: { verdict: "appropriate" },
      },
    );

    expect(recorded).toHaveLength(0);
  });
});

describe("sessionKeyFor", () => {
  it("ignores subject order and changes with the day", () => {
    const day = new Date("2026-09-01T10:00:00.000Z");

    expect(sessionKeyFor(["fahren", "gehen"], day)).toBe(
      sessionKeyFor(["gehen", "fahren"], day),
    );
    expect(sessionKeyFor(["fahren"], day)).not.toBe(
      sessionKeyFor(["fahren"], new Date("2026-09-02T10:00:00.000Z")),
    );
  });
});

const MINING = {
  recurring: [
    {
      errorType: "word_order",
      pattern: 'In a "weil" clause the verb goes last.',
      utterance: "weil ich bin müde",
    },
  ],
  vocabGaps: ["verspätung", "nirgendwort"],
  vocabSeen: ["fahren"],
};

const ITEMS = [
  { id: "88888888-8888-4888-8888-888888888888", lemma: "verspätung", word: "die Verspätung" },
  { id: "99999999-9999-4999-8999-999999999999", lemma: "fahren", word: "fahren" },
];

function mineDeps(options: {
  replies?: ReadonlyArray<string | { failure: string }>;
  claimed?: boolean;
} = {}) {
  const recorded: unknown[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  const gatewayCalls: unknown[] = [];
  const queue = [...(options.replies ?? [JSON.stringify(MINING)])];

  const deps: MineDeps = {
    gateway: {
      complete: async (spec: unknown) => {
        gatewayCalls.push(spec);
        const next = queue.shift();
        if (next === undefined || typeof next !== "string") {
          return {
            ok: false as const,
            failure: (next as { failure: string } | undefined)?.failure ?? "provider_error",
            detail: "scripted",
          };
        }
        return gatewayOk({ text: next, costEur: 0.001 });
      },
    } as unknown as ModelGateway,
    errors: {
      record: async (observation: unknown) => {
        recorded.push(observation);
        return ok("id");
      },
    } as never,
    vocabulary: {
      findByLemmas: async (lemmas: readonly string[]) =>
        ok(ITEMS.filter((item) => lemmas.includes(item.lemma))),
      listByItems: async () => ok([]),
      upsertLearnerVocabulary: async (record: Record<string, unknown>) => {
        upserts.push(record);
        return ok(record);
      },
    } as never,
    learners: {
      getState: async () =>
        ok({ miniLevel: 26, effectiveLevel: { cefr: "A2" as const, plus: false } }),
    } as never,
    mined: {
      claim: async () => ok(options.claimed ?? true),
    } as never,
    learnerId: LEARNER,
    requestId: REQUEST,
    userIdHash: "hash-alice",
    budget: createTurnBudget(0.01),
  };

  return { deps, recorded, upserts, gatewayCalls };
}

const INPUT = {
  transcript: [
    { role: "assistant" as const, content: "Wie sagt man 'delay'?" },
    { role: "user" as const, content: "Ich weiß nicht... the train had a delay?" },
  ],
  covered: ["fahren", "Nachrichten von heute"],
};

describe("mineSession", () => {
  it("records recurring mistakes and folds vocabulary through the engine", async () => {
    const { deps, recorded, upserts } = mineDeps();

    await mineSession(deps, INPUT);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ errorType: "word_order" });

    // Two catalogue words; "nirgendwort" resolved to nothing and cost nothing.
    expect(upserts).toHaveLength(2);
    const gap = upserts.find(
      (record) => record.vocabularyItemId === ITEMS[0]?.id,
    );
    const seen = upserts.find(
      (record) => record.vocabularyItemId === ITEMS[1]?.id,
    );
    // A gap is a lapse: an incorrect use, due again soon. A word merely seen
    // is an exposure: met, not yet produced.
    expect(gap).toMatchObject({ incorrectCount: 1 });
    expect(seen).toMatchObject({ incorrectCount: 0, exposureCount: 1 });
  });

  it("mines nothing twice: a lost claim is a hard stop", async () => {
    const { deps, recorded, upserts, gatewayCalls } = mineDeps({ claimed: false });

    await mineSession(deps, INPUT);

    expect(gatewayCalls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("writes nothing when the budget refuses the call", async () => {
    const { deps, recorded, upserts } = mineDeps({
      replies: [{ failure: "budget_denied" }],
    });

    await mineSession(deps, INPUT);

    expect(recorded).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("repairs once, then gives up without writing", async () => {
    const { deps, recorded, upserts, gatewayCalls } = mineDeps({
      replies: ["not json", "still not json"],
    });

    await mineSession(deps, INPUT);

    expect(gatewayCalls).toHaveLength(2);
    expect(recorded).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("recovers a usable object on the repair pass", async () => {
    const { deps, recorded, gatewayCalls } = mineDeps({
      replies: ["garbage first", JSON.stringify(MINING)],
    });

    await mineSession(deps, INPUT);

    expect(gatewayCalls).toHaveLength(2);
    expect(recorded).toHaveLength(1);
  });
});
