import { z } from "zod";

import { cefrLevelSchema } from "./cefr";
import { grammarPatternKeySchema } from "./grammar";
import { errorTypeSchema } from "./learner-error";
import { nonEmptyTextSchema, unitIntervalSchema } from "./primitives";

/**
 * The structured output of learning evaluation.
 *
 * Every list is capped. A model that loops can otherwise return thousands of
 * entries, and this output is written straight into learner state.
 */
const MAX_LIST = 50;

const lemmaSchema = nonEmptyTextSchema(64);

export const evaluatedErrorSchema = z.object({
  errorType: errorTypeSchema,
  excerpt: nonEmptyTextSchema(500).describe("the learner's own German, verbatim"),
  corrected: nonEmptyTextSchema(500).describe("the corrected German"),
  // In English by domain contract, not by prompt-writing preference: the
  // product teaches English speakers, and this sentence is rendered to them
  // on the dashboard as the explanation of their own recurring mistake. A
  // German explanation of a German mistake explains nothing to its reader.
  // The description also fixes the form, because the correction has to live
  // inside this sentence — the dashboard stores no separate corrected field —
  // so 'Number is misspelled; the correct spelling is "Nummer"' is the shape,
  // never a German sentence about German.
  explanation: nonEmptyTextSchema(1000).describe(
    'written in English, quoting German only inside quotation marks, and ' +
      'naming the correct form, e.g. the correct spelling is "Nummer" — ' +
      "the learner reads this sentence on their dashboard",
  ),
});

export const masterySignalSchema = z.object({
  lemma: lemmaSchema,
  direction: z.enum(["up", "down"]),
});

export const learningEvaluationSchema = z.object({
  estimatedLevel: cefrLevelSchema,
  levelConfidence: unitIntervalSchema,
  vocabularyUsed: z.array(lemmaSchema).max(MAX_LIST),
  vocabularyWeaknesses: z.array(lemmaSchema).max(MAX_LIST),
  grammarPatternsUsed: z.array(grammarPatternKeySchema).max(MAX_LIST),
  errors: z.array(evaluatedErrorSchema).max(MAX_LIST),
  skillEstimates: z.object({
    fluency: unitIntervalSchema,
    comprehension: unitIntervalSchema,
    accuracy: unitIntervalSchema,
    range: unitIntervalSchema,
  }),
  masterySignals: z.array(masterySignalSchema).max(MAX_LIST),
  reviewCandidates: z.array(lemmaSchema).max(MAX_LIST),
  recommendationSignals: z.array(nonEmptyTextSchema(64)).max(MAX_LIST),
});

export type LearningEvaluation = z.infer<typeof learningEvaluationSchema>;

/** Beyond this, the response is treated as runaway output rather than parsed. */
export const MAX_MODEL_JSON_BYTES = 100_000;

export type ModelJsonFailureReason =
  | "too_large"
  | "invalid_json"
  | "schema_mismatch";

export type ModelJsonResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly reason: ModelJsonFailureReason;
      readonly issues: readonly string[];
    };

/**
 * Extracts the first balanced JSON object in the text.
 *
 * Models wrap JSON in fences and surround it with prose. A greedy match from
 * the first brace to the last would swallow trailing commentary, so this walks
 * the string tracking depth, and ignores braces inside string literals.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      inString = !inString;
    } else if (!inString) {
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extracts the JSON object without validating its shape.
 *
 * For the recovery path only: something has to look inside a response that
 * already failed validation, and it has to do so without a schema, because
 * the schema is what rejected it. Nothing downstream may treat the result as
 * trusted — recovery validates every field it keeps.
 */
export function parseModelObject(raw: string): ModelJsonResult<unknown> {
  if (raw.length > MAX_MODEL_JSON_BYTES) {
    return { ok: false, reason: "too_large", issues: ["response too large"] };
  }

  const candidate = extractJsonObject(raw);
  if (candidate === null) {
    return {
      ok: false,
      reason: "invalid_json",
      issues: ["no JSON object found in response"],
    };
  }

  try {
    return { ok: true, data: JSON.parse(candidate) as unknown };
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      issues: ["response was not valid JSON"],
    };
  }
}

/**
 * Parses and validates a model's structured response.
 *
 * Never trust model output (security-observability-guardrails.md S12). The
 * failure result carries schema issue paths but never the raw payload, so a
 * logged validation failure cannot become the leak.
 */
export function parseModelJson<T>(
  raw: string,
  schema: z.ZodType<T>,
): ModelJsonResult<T> {
  if (raw.length > MAX_MODEL_JSON_BYTES) {
    return { ok: false, reason: "too_large", issues: ["response too large"] };
  }

  const candidate = extractJsonObject(raw);
  if (candidate === null) {
    return {
      ok: false,
      reason: "invalid_json",
      issues: ["no JSON object found in response"],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      issues: ["response was not valid JSON"],
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: "schema_mismatch",
      // Paths and codes only. The offending values stay out of the result.
      issues: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`,
      ),
    };
  }

  return { ok: true, data: result.data };
}
