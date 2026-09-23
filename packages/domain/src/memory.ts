import { z } from "zod";

import {
  nonEmptyTextSchema,
  timestampSchema,
  unitIntervalSchema,
  uuidSchema,
} from "./primitives";

const MAX_MEMORY_LENGTH = 500;

const memoryBase = {
  id: uuidSchema,
  learnerId: uuidSchema,
  content: nonEmptyTextSchema(MAX_MEMORY_LENGTH),
  salience: unitIntervalSchema,
  createdAt: timestampSchema,
};

/**
 * Long-term memories, discriminated by kind. A recurring-error memory must
 * point at the structured error record rather than restating it, so the
 * aggregate stays the single source of truth.
 */
export const learnerMemorySchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...memoryBase, kind: z.literal("interest") }),
  z.strictObject({ ...memoryBase, kind: z.literal("goal") }),
  z.strictObject({ ...memoryBase, kind: z.literal("preference") }),
  z.strictObject({ ...memoryBase, kind: z.literal("achievement") }),
  z.strictObject({ ...memoryBase, kind: z.literal("fact") }),
  z.strictObject({
    ...memoryBase,
    kind: z.literal("recurring_error"),
    learnerErrorId: uuidSchema,
  }),
]);

export type LearnerMemory = z.infer<typeof learnerMemorySchema>;

/**
 * Independent secret filter for memory candidates.
 *
 * The extraction prompt is told not to propose credentials, but a prompt is
 * not a control (security-observability-guardrails.md S15). This runs on the
 * application side and does not trust the model's compliance.
 *
 * Deliberately conservative: it errs toward discarding a memory. Losing one
 * learning detail costs nothing; persisting a learner's password is
 * unrecoverable.
 */
const FORBIDDEN_MEMORY_PATTERNS: readonly RegExp[] = [
  // Credential vocabulary, English and German.
  /\b(password|passwort|passphrase|pin|otp|api[\s_-]?key|secret|token|credential|kennwort)\b/i,
  // Known key shapes.
  /\bsk[-_](live|test|proj)?[-_]?[a-z0-9]{16,}/i,
  /\bsb_(secret|publishable)_[a-z0-9]{8,}/i,
  /\bgh[pousr]_[a-z0-9]{20,}/i,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\./i,
  // Payment card numbers, with or without separators.
  /\b(?:\d[ -]?){13,19}\b/,
];

export function isSafeToStoreAsMemory(content: string): boolean {
  return !FORBIDDEN_MEMORY_PATTERNS.some((pattern) => pattern.test(content));
}
