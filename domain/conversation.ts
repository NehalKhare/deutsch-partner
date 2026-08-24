import { z } from "zod";

import { cefrLevelSchema, miniLevelSchema } from "@/domain/cefr";
import {
  nonEmptyTextSchema,
  timestampSchema,
  uuidSchema,
} from "@/domain/primitives";

export const CONVERSATION_MODES = [
  "free_chat",
  "roleplay",
  "travel",
  "daily_life",
  "work",
  "hobbies",
  "storytelling",
  "opinions",
  "problem_solving",
  "grammar_practice",
  "vocabulary_practice",
  "review",
  "assessment",
] as const;

export const conversationModeSchema = z.enum(CONVERSATION_MODES);
export type ConversationMode = z.infer<typeof conversationModeSchema>;

export const conversationThreadSchema = z
  .object({
    id: uuidSchema,
    learnerId: uuidSchema,
    title: nonEmptyTextSchema(200),
    topic: nonEmptyTextSchema(64),
    cefr: cefrLevelSchema,
    miniLevel: miniLevelSchema,
    mode: conversationModeSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .refine((thread) => thread.updatedAt >= thread.createdAt, {
    error: "updatedAt precedes createdAt",
    path: ["updatedAt"],
  });

export type ConversationThread = z.infer<typeof conversationThreadSchema>;

/** Matches the input validation ceiling; longer input is rejected, not truncated. */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * How much of the in-memory transcript one turn carries to the model.
 *
 * Lives in the domain because both sides of the wire hold it: the client keeps
 * the transcript and sends the newest window, and the server refuses a body
 * that claims more history than this. Never the whole conversation — the
 * context budget is per turn, and a transcript grows without limit.
 */
export const HISTORY_WINDOW = 8;

/**
 * One line of the transcript as the client resends it.
 *
 * Strict, because it arrives from the network: a transcript is client memory,
 * so the server treats it as a claim about the conversation, not a record of
 * it. Only the two speaking roles exist — there is no way to smuggle a
 * "system" line in through history.
 */
export const transcriptMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: nonEmptyTextSchema(MAX_MESSAGE_LENGTH),
});

export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;
