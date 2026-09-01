import { z } from "zod";

import { errorTypeSchema } from "@/domain/learner-error";
import { nonEmptyTextSchema } from "@/domain/primitives";

/**
 * What the Trainer's answer analyzer and post-session miner return.
 *
 * Both are machine-register specialist calls: one pass over learner German,
 * one typed verdict, validated with parseModelJson before anything reads it.
 * Every list is small and capped — these shapes are sized for the cheap tier,
 * where a sprawling schema is the difference between a validated object and a
 * repair pass — and every error category comes from the closed taxonomy, so
 * findings can flow into learner_errors rows without translation.
 *
 * The .describe() annotations are prompt content: the catalogue renders them
 * into the output contract, which is where a machine prompt says what it is
 * actually asking for.
 */

/** How one analyzed answer went, before any per-finding detail. */
export const answerVerdictSchema = z
  .enum(["correct", "partially_correct", "incorrect", "not_an_answer"])
  .describe(
    "how the learner's German answers the exercise; not_an_answer when the message is not an attempt at it",
  );

export const analysisFindingSchema = z.strictObject({
  errorType: errorTypeSchema,
  excerpt: nonEmptyTextSchema(200).describe("the learner's own German, verbatim"),
  corrected: nonEmptyTextSchema(200).describe("the corrected German"),
  note: nonEmptyTextSchema(300).describe(
    "one English line naming the rule and the correct form",
  ),
});

export const answerAnalysisSchema = z.strictObject({
  verdict: answerVerdictSchema,
  findings: z
    .array(analysisFindingSchema)
    .max(4)
    .describe("the grammar slips worth naming: word order, case, gender, endings"),
  anglicisms: z
    .array(
      z.strictObject({
        excerpt: nonEmptyTextSchema(100).describe("the literal English-shaped German"),
        idiomatic: nonEmptyTextSchema(100).describe(
          "what a German speaker would actually say",
        ),
      }),
    )
    .max(2),
  vocabularyElevation: z
    .array(
      z.strictObject({
        used: nonEmptyTextSchema(64).describe("the word the learner used"),
        upgrade: nonEmptyTextSchema(64).describe(
          "a more natural or precise word at their level",
        ),
        gloss: nonEmptyTextSchema(100).describe("the upgrade's English meaning"),
      }),
    )
    .max(2)
    .describe("only when a real alternative exists; an invented one teaches a wrong instinct"),
  register: z.strictObject({
    verdict: z
      .enum(["appropriate", "too_informal", "too_formal", "mixed"])
      .describe("du/Sie and register against what the exchange calls for"),
    note: nonEmptyTextSchema(200)
      .describe("one English line, only when the verdict is not appropriate")
      .optional(),
  }),
});

export type AnswerAnalysis = z.infer<typeof answerAnalysisSchema>;
export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;

const lemmaSchema = nonEmptyTextSchema(64);

export const sessionMiningSchema = z.strictObject({
  recurring: z
    .array(
      z.strictObject({
        errorType: errorTypeSchema,
        pattern: nonEmptyTextSchema(300).describe(
          "written in English, quoting German only inside quotation marks, and naming the correct form",
        ),
        utterance: nonEmptyTextSchema(500)
          .describe("the learner's own words, verbatim")
          .optional(),
      }),
    )
    .max(5)
    .describe("mistakes the learner made more than once across the session"),
  vocabGaps: z
    .array(lemmaSchema)
    .max(5)
    .describe(
      "German dictionary forms the learner reached for and lacked — asked for in English, or circumlocuted",
    ),
  vocabSeen: z
    .array(lemmaSchema)
    .max(10)
    .describe("German dictionary forms the learner read or used adequately"),
});

export type SessionMining = z.infer<typeof sessionMiningSchema>;
