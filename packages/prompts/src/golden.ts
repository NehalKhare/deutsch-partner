import { z } from "zod";

import { STREAMED_TEXT, type OutputContract } from "./contract";
import type { PromptCatalogEntry } from "./catalogue";

/**
 * Golden evaluation sets.
 *
 * Every catalogue entry names an `evalSet`; this module is the shape those
 * sets take and the scorer that judges an output against one case. It does no
 * I/O on purpose — the prompts package may not touch the filesystem, the
 * clock or the environment — so the files themselves are read by whoever runs
 * the evaluation: the deterministic test in this package, or a live runner
 * that has a gateway and a budget.
 *
 * A case has three parts. `input` is what the prompt is given and must satisfy
 * the entry's input schema. `reference` is one correct output: a full object
 * the entry's contract accepts, or, for a streamed prose entry, the reply as
 * text. `expect` is the part of a correct answer that matters — a subset of
 * the structure, or assertions over the prose — because a live model may word
 * things differently and still be right. The reference must itself satisfy
 * `expect`, which the test checks, so an expectation that no correct answer
 * could meet is caught before a model is blamed for it.
 */

export const textExpectationSchema = z.strictObject({
  /** At least one of these must appear (case-insensitive). */
  mustContainAny: z.array(z.string().min(1)).max(10).default([]),
  /** None of these may appear (case-insensitive). */
  mustNotContain: z.array(z.string().min(1)).max(10).default([]),
  maxWords: z.number().int().positive().optional(),
  /** The reply must end on a question, which keeps a conversation going. */
  endsWithQuestion: z.boolean().optional(),
});

export type TextExpectation = z.input<typeof textExpectationSchema>;

export const goldenCaseSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "a case id is a kebab-case slug"),
  /** What the case is checking, for the person reading a failure. */
  note: z.string().min(1).max(400).optional(),
  input: z.record(z.string(), z.unknown()),
  reference: z.unknown(),
  expect: z.unknown(),
});

export type GoldenCase = z.infer<typeof goldenCaseSchema>;

export const goldenSetSchema = z.strictObject({
  evalSet: z.string().regex(/^golden\/[a-z0-9-]+$/),
  description: z.string().min(1).max(1000),
  cases: z.array(goldenCaseSchema).min(1).max(200),
});

export type GoldenSet = z.infer<typeof goldenSetSchema>;

/** The file name an evalSet declaration resolves to, without its directory. */
export function goldenFileFor(evalSet: string): string {
  return `${evalSet.replace(/^golden\//, "")}.json`;
}

export interface Score {
  readonly ok: boolean;
  /** Each a path and what was wrong there; empty when ok. */
  readonly mismatches: readonly string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Subset match: everything `expected` states must hold in `actual`.
 *
 * Objects match key by key, so an expectation names only the fields that
 * matter. Arrays match as a subset too — every expected element must be
 * matched by some actual element — so an expectation can say "an error of
 * type word_order is reported" without pinning the order or the other
 * findings. Primitives match by equality.
 */
export function matchesExpectation(
  actual: unknown,
  expected: unknown,
  path = "$",
): Score {
  // A prose field inside a structured output: `{ "$containsAny": [...] }`
  // asks that the text carry one of the phrases rather than equal a sentence
  // a model would never reproduce word for word.
  if (isObject(expected) && Array.isArray(expected.$containsAny)) {
    if (typeof actual !== "string") {
      return { ok: false, mismatches: [`${path}: expected text`] };
    }
    const needles = expected.$containsAny.filter(
      (needle): needle is string => typeof needle === "string",
    );
    const haystack = actual.toLowerCase();
    return needles.some((needle) => haystack.includes(needle.toLowerCase()))
      ? { ok: true, mismatches: [] }
      : { ok: false, mismatches: [`${path}: none of ${JSON.stringify(needles)} appears`] };
  }

  if (isObject(expected)) {
    if (!isObject(actual)) {
      return { ok: false, mismatches: [`${path}: expected an object`] };
    }
    const mismatches = Object.entries(expected).flatMap(([key, value]) =>
      matchesExpectation(actual[key], value, `${path}.${key}`).mismatches,
    );
    return { ok: mismatches.length === 0, mismatches };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { ok: false, mismatches: [`${path}: expected an array`] };
    }
    const mismatches = expected.flatMap((item, index) =>
      actual.some((candidate) => matchesExpectation(candidate, item).ok)
        ? []
        : [`${path}[${index}]: no element matches ${JSON.stringify(item)}`],
    );
    return { ok: mismatches.length === 0, mismatches };
  }

  if (Object.is(actual, expected)) return { ok: true, mismatches: [] };

  return {
    ok: false,
    mismatches: [
      `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    ],
  };
}

/** Assertions over a streamed reply. */
export function scoreText(actual: string, expectation: TextExpectation): Score {
  const expected = textExpectationSchema.parse(expectation);
  const haystack = actual.toLowerCase();
  const mismatches: string[] = [];

  if (
    expected.mustContainAny.length > 0 &&
    !expected.mustContainAny.some((needle) => haystack.includes(needle.toLowerCase()))
  ) {
    mismatches.push(`none of ${JSON.stringify(expected.mustContainAny)} appears`);
  }
  for (const needle of expected.mustNotContain) {
    if (haystack.includes(needle.toLowerCase())) {
      mismatches.push(`${JSON.stringify(needle)} appears`);
    }
  }
  if (expected.maxWords !== undefined) {
    const words = actual.trim().split(/\s+/).filter(Boolean).length;
    if (words > expected.maxWords) {
      mismatches.push(`${words} words exceeds ${expected.maxWords}`);
    }
  }
  if (expected.endsWithQuestion !== undefined) {
    const ends = /\?\s*$/.test(actual.trim());
    if (ends !== expected.endsWithQuestion) {
      mismatches.push(
        expected.endsWithQuestion
          ? "does not end with a question"
          : "ends with a question",
      );
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Judges one output against one case under the entry's contract.
 *
 * A structured output must first parse under the contract — a reply the
 * application would reject is wrong before its content is looked at — and
 * then match the expectation. A streamed reply is judged by its text
 * assertions alone.
 */
export function scoreGoldenCase(
  entry: Pick<PromptCatalogEntry, "outputContract">,
  goldenCase: GoldenCase,
  actual: unknown,
): Score {
  const contract: OutputContract = entry.outputContract;

  if (contract === STREAMED_TEXT) {
    if (typeof actual !== "string") {
      return { ok: false, mismatches: ["$: a streamed reply is text"] };
    }
    return scoreText(actual, goldenCase.expect as TextExpectation);
  }

  const parsed = (contract as z.ZodTypeAny).safeParse(actual);
  if (!parsed.success) {
    return {
      ok: false,
      mismatches: parsed.error.issues.map(
        (issue) => `$.${issue.path.join(".")}: ${issue.message}`,
      ),
    };
  }

  return matchesExpectation(parsed.data, goldenCase.expect);
}
