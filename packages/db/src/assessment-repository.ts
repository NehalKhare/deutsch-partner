import { z } from "zod";

import { cefrLevelSchema, miniLevelSchema } from "@dp/domain/cefr";
import { unitIntervalSchema, uuidSchema } from "@dp/domain/primitives";
import type { RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import type { DatabaseClient } from "./types";

const ASSESSMENTS = "assessments";

export const ASSESSMENT_KINDS = [
  "onboarding",
  "mini_level_check",
  "a1_milestone",
  "a2_milestone",
  "b1_readiness",
] as const;

/**
 * Note what is absent: there is no field for an official certification. The
 * product reports a readiness estimate and nothing more.
 */
export const assessmentInputSchema = z.strictObject({
  learnerId: uuidSchema,
  kind: z.enum(ASSESSMENT_KINDS),
  miniLevel: miniLevelSchema.optional(),
  estimatedCefr: cefrLevelSchema.optional(),
  score: unitIntervalSchema.optional(),
  passed: z.boolean().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type AssessmentInput = z.infer<typeof assessmentInputSchema>;

const assessmentRowSchema = z.object({
  id: uuidSchema,
  learner_id: uuidSchema,
  kind: z.enum(ASSESSMENT_KINDS),
  mini_level: miniLevelSchema.nullable(),
  estimated_cefr: cefrLevelSchema.nullable(),
  score: z.union([z.number(), z.string()]).nullable().transform((v) =>
    v === null ? null : Number(v),
  ),
  passed: z.boolean().nullable(),
  created_at: z.union([z.date(), z.string().transform((s) => new Date(s))]),
});

const assessmentFromRow = assessmentRowSchema.transform((row) => ({
  id: row.id,
  learnerId: row.learner_id,
  kind: row.kind,
  miniLevel: row.mini_level,
  estimatedCefr: row.estimated_cefr,
  score: row.score,
  passed: row.passed,
  createdAt: row.created_at,
}));

export type Assessment = z.infer<typeof assessmentFromRow>;

export interface AssessmentRepository {
  record(input: AssessmentInput): Promise<RepositoryResult<Assessment>>;
  listForLearner(
    learnerId: string,
    limit: number,
  ): Promise<RepositoryResult<Assessment[]>>;
}

export function createAssessmentRepository(
  client: DatabaseClient,
): AssessmentRepository {
  return {
    async record(input) {
      const parsed = decodeInput(input, assessmentInputSchema);
      if (!parsed.ok) return parsed;

      const outcome = await client
        .from(ASSESSMENTS)
        .insert({
          learner_id: parsed.data.learnerId,
          kind: parsed.data.kind,
          mini_level: parsed.data.miniLevel ?? null,
          estimated_cefr: parsed.data.estimatedCefr ?? null,
          score: parsed.data.score ?? null,
          passed: parsed.data.passed ?? null,
          detail: parsed.data.detail ?? {},
        })
        .select("*")
        .single();

      return decodeRow(outcome, assessmentFromRow);
    },

    async listForLearner(learnerId, limit) {
      const outcome = await client
        .from(ASSESSMENTS)
        .select("*")
        .eq("learner_id", learnerId)
        .order("created_at", { ascending: false })
        .limit(limit);

      return decodeRows(outcome, assessmentFromRow);
    },
  };
}
