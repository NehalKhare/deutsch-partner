import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { effectiveLevelSchema } from "../src/cefr";
import { companionStateSchema } from "../src/companion";
import {
  conversationThreadSchema,
  transcriptMessageSchema,
} from "../src/conversation";
import { learningEvaluationSchema } from "../src/evaluation";
import { grammarPatternSchema } from "../src/grammar";
import { learnerErrorSchema } from "../src/learner-error";
import { learnerProfileSchema, learnerStateSchema } from "../src/learner";
import { learnerMemorySchema } from "../src/memory";
import { levelPerformanceSchema } from "../src/performance";
import { recommendationSchema } from "../src/recommendation";
import { retrievalContextSchema } from "../src/retrieval";
import {
  learnerVocabularySchema,
  vocabularyItemSchema,
} from "../src/vocabulary";

/**
 * Zod 4 runs refinements even when the base shape already failed, unlike Zod 3.
 * A cross-field refinement that calls a throwing helper therefore escapes
 * safeParse as an exception instead of returning a failure — which would turn a
 * malformed request into a 500 rather than a clean rejection.
 *
 * Every schema must reject bad input by returning, never by throwing.
 */
const SCHEMAS: ReadonlyArray<[string, z.ZodType]> = [
  ["effectiveLevel", effectiveLevelSchema],
  ["companionState", companionStateSchema],
  ["transcriptMessage", transcriptMessageSchema],
  ["conversationThread", conversationThreadSchema],
  ["learningEvaluation", learningEvaluationSchema],
  ["grammarPattern", grammarPatternSchema],
  ["learnerError", learnerErrorSchema],
  ["learnerProfile", learnerProfileSchema],
  ["learnerState", learnerStateSchema],
  ["learnerMemory", learnerMemorySchema],
  ["levelPerformance", levelPerformanceSchema],
  ["recommendation", recommendationSchema],
  ["retrievalContext", retrievalContextSchema],
  ["learnerVocabulary", learnerVocabularySchema],
  ["vocabularyItem", vocabularyItemSchema],
];

const HOSTILE_INPUTS: ReadonlyArray<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["empty object", {}],
  ["array", []],
  ["string", "nonsense"],
  ["number", 42],
  ["out-of-range mini-level", { miniLevel: 99, cefr: "A1" }],
  ["negative mini-level", { miniLevel: -5, cefr: "B1" }],
  ["non-integer mini-level", { miniLevel: 2.5, cefr: "A1" }],
  ["wrong-typed fields", { miniLevel: "20", cefr: 7, createdAt: true }],
  ["prototype pollution attempt", { __proto__: { admin: true }, miniLevel: 99 }],
];

describe.each(SCHEMAS)("%s", (_name, schema) => {
  it.each(HOSTILE_INPUTS)("rejects %s without throwing", (_label, input) => {
    expect(() => schema.safeParse(input)).not.toThrow();
    expect(schema.safeParse(input).success).toBe(false);
  });
});
