import { z } from "zod";

import { miniLevelSchema } from "./cefr";
import { conversationModeSchema } from "./conversation";
import { errorTypeSchema } from "./learner-error";
import {
  nonEmptyTextSchema,
  timestampSchema,
  unitIntervalSchema,
  uuidSchema,
} from "./primitives";

export const ACTIVITY_TYPES = [
  "conversation",
  "review",
  "vocabulary_drill",
  "grammar_drill",
  "roleplay",
  "assessment",
] as const;

export const activityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof activityTypeSchema>;

/**
 * Why this activity was recommended. A closed, structured set rather than free
 * text, because ranking is deterministic and every recommendation has to be
 * explainable to the learner without asking a model to justify it.
 */
export const recommendationReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("review_due"),
    dueCount: z.number().int().min(1),
  }),
  z.strictObject({ kind: z.literal("weakness"), errorType: errorTypeSchema }),
  z.strictObject({
    kind: z.literal("interest"),
    interest: nonEmptyTextSchema(64),
  }),
  z.strictObject({
    kind: z.literal("level_progression"),
    miniLevel: miniLevelSchema,
  }),
]);

export type RecommendationReason = z.infer<typeof recommendationReasonSchema>;

export const recommendationSchema = z
  .object({
    id: uuidSchema,
    learnerId: uuidSchema,
    activityType: activityTypeSchema,
    mode: conversationModeSchema,
    topic: nonEmptyTextSchema(64),
    reason: recommendationReasonSchema,
    score: unitIntervalSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema.nullable(),
  })
  .refine((rec) => rec.expiresAt === null || rec.expiresAt >= rec.createdAt, {
    error: "expiresAt precedes createdAt",
    path: ["expiresAt"],
  });

export type Recommendation = z.infer<typeof recommendationSchema>;
