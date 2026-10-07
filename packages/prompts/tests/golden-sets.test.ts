import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CEFR_LEVELS, type CEFRLevel } from "@dp/domain/cefr";
import {
  PROMPT_CATALOGUE,
  STREAMED_TEXT,
  behaviorPolicyFor,
  buildPrompt,
  goldenFileFor,
  goldenSetSchema,
  scoreGoldenCase,
  type BuildRequest,
  type GoldenCase,
  type GoldenSet,
  type PromptCatalogEntry,
} from "../src/index";

/**
 * Every evalSet the catalogue declares is backed by a corpus, and every case in
 * it is coherent: the input fits the entry's input schema, the reference fits
 * the entry's contract, the reference satisfies its own expectation, and the
 * input renders under the task's ceiling.
 *
 * Deterministic on purpose, like the Trainer's golden test: no model is
 * called. A live runner reads the same files, sends each input through the
 * gateway, and scores the reply with the same scorer.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  join(HERE, "..", "golden"),
  // The Trainer's analyzer corpus predates this directory and stays beside
  // the pipeline test that drives it.
  join(HERE, "..", "..", "..", "apps", "learner", "tests", "golden"),
];

function locate(evalSet: string): string | null {
  const file = goldenFileFor(evalSet);
  return ROOTS.map((root) => join(root, file)).find((path) => existsSync(path)) ?? null;
}

/** The sets in this package's own directory, parsed. The learner-hosted one has its own test. */
const hosted = PROMPT_CATALOGUE.flatMap((entry) => {
  const path = join(ROOTS[0], goldenFileFor(entry.evalSet));
  if (!existsSync(path)) return [];
  const set = goldenSetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return [[entry, set] as const];
});

const MIN_CASES = 3;

function fixtureRequest(entry: PromptCatalogEntry, goldenCase: GoldenCase): BuildRequest {
  const input = goldenCase.input;
  const cefr = (
    CEFR_LEVELS.includes(input.cefr as CEFRLevel) ? input.cefr : "A2"
  ) as CEFRLevel;
  const userMessage = Object.values(input).find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!userMessage) throw new Error(`${entry.name}/${goldenCase.id}: no text in input`);
  const preceding = Array.isArray(input.precedingTurns)
    ? (input.precedingTurns as BuildRequest["recentMessages"])
    : [];

  return {
    policy: behaviorPolicyFor({ cefr }),
    cefr,
    learner: {
      effectiveLevel: { cefr, plus: false },
      miniLevel: 21,
      theme: "Am Bahnhof",
      focus: "travel problems and asking for information",
      learningGoal: "Talk to my colleagues in Berlin without switching to English.",
      interests: ["cycling"],
      targetVocabulary: ["die Verspätung", "umsteigen"],
      targetGrammar: ["indirect questions inside a polite frame"],
      dueVocabulary: ["der Zug"],
      recurringErrors: [],
      justMoved: null,
    },
    threadSummary: null,
    knowledge: [],
    memories: [],
    recentMessages: preceding,
    userMessage,
  } as BuildRequest;
}

describe("every declared eval set is backed by a corpus", () => {
  it.each(PROMPT_CATALOGUE.map((entry) => [entry.name, entry.evalSet] as const))(
    "%s declares %s and a file stands behind it",
    (_name, evalSet) => {
      expect(locate(evalSet), `${evalSet} has no golden file`).not.toBeNull();
    },
  );

  it("covers the whole catalogue from this directory except the Trainer analyzer", () => {
    const covered = new Set(hosted.map(([entry]) => entry.name));
    const elsewhere = PROMPT_CATALOGUE.filter((entry) => !covered.has(entry.name)).map(
      (entry) => entry.name,
    );

    expect(elsewhere).toEqual(["trainer.answer_analysis"]);
  });
});

describe.each(hosted.map(([entry, set]) => [entry.name, entry, set] as const))(
  "%s",
  (_name, entry, set: GoldenSet) => {
    it("names the entry's own eval set and holds enough cases to mean something", () => {
      expect(set.evalSet).toBe(entry.evalSet);
      expect(set.cases.length).toBeGreaterThanOrEqual(MIN_CASES);
    });

    it("gives every case a unique id", () => {
      const ids = set.cases.map((goldenCase) => goldenCase.id);

      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    });

    it.each(set.cases.map((goldenCase) => [goldenCase.id, goldenCase] as const))(
      "%s has an input the entry accepts",
      (_id, goldenCase) => {
        const parsed = entry.inputSchema.safeParse(goldenCase.input);

        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      },
    );

    it.each(set.cases.map((goldenCase) => [goldenCase.id, goldenCase] as const))(
      "%s carries a reference the contract accepts",
      (_id, goldenCase) => {
        if (entry.outputContract === STREAMED_TEXT) {
          expect(typeof goldenCase.reference).toBe("string");
          return;
        }
        const parsed = entry.outputContract.safeParse(goldenCase.reference);

        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      },
    );

    it.each(set.cases.map((goldenCase) => [goldenCase.id, goldenCase] as const))(
      "%s has an expectation its own reference satisfies",
      (_id, goldenCase) => {
        const score = scoreGoldenCase(entry, goldenCase, goldenCase.reference);

        expect(score.mismatches).toEqual([]);
        expect(score.ok).toBe(true);
      },
    );

    it.each(set.cases.map((goldenCase) => [goldenCase.id, goldenCase] as const))(
      "%s renders under the task's input ceiling",
      (_id, goldenCase) => {
        const outcome = buildPrompt(entry, fixtureRequest(entry, goldenCase));

        expect(outcome.ok, outcome.ok ? "" : `${outcome.reason}: ${outcome.detail}`).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.prompt.tokens.total).toBeLessThanOrEqual(outcome.prompt.maxInputTokens);
        // The fixture is small; nothing should have had to be shed to fit.
        expect(outcome.prompt.shed).toEqual([]);
      },
    );
  },
);
