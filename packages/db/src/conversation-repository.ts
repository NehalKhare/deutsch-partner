import { z } from "zod";

import {
  conversationModeSchema,
  type ConversationThread,
} from "@dp/domain/conversation";
import { nonEmptyTextSchema } from "@dp/domain/primitives";
import { fail, ok, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import { conversationThreadFromRow } from "./rows";
import type { DatabaseClient } from "./types";

const THREADS = "conversation_threads";

/**
 * What a caller may ask for when opening a thread.
 *
 * No learner id, no level: the database function reads both from the verified
 * session and the learner's own record, so a caller cannot open a thread for
 * someone else or claim a level they are not at.
 */
export const newThreadSchema = z.strictObject({
  title: nonEmptyTextSchema(200),
  topic: nonEmptyTextSchema(64),
  mode: conversationModeSchema,
});

export type NewThread = z.infer<typeof newThreadSchema>;

/** The fields a learner may change after a thread exists. */
export const threadUpdateSchema = z
  .strictObject({
    title: nonEmptyTextSchema(200).optional(),
    topic: nonEmptyTextSchema(64).optional(),
    mode: conversationModeSchema.optional(),
  })
  .refine((update) => Object.keys(update).length > 0, {
    error: "an update must change something",
  });

export type ThreadUpdate = z.infer<typeof threadUpdateSchema>;

/**
 * A learner accumulates threads indefinitely, so the list is bounded here
 * rather than left to grow into an unbounded query.
 */
export const DEFAULT_THREAD_PAGE = 50;
export const MAX_THREAD_PAGE = 200;

export interface ConversationRepository {
  listThreads(
    learnerId: string,
    limit?: number,
  ): Promise<RepositoryResult<ConversationThread[]>>;
  getThread(threadId: string): Promise<RepositoryResult<ConversationThread>>;
  createThread(thread: unknown): Promise<RepositoryResult<ConversationThread>>;
  updateThread(
    threadId: string,
    update: unknown,
  ): Promise<RepositoryResult<ConversationThread>>;
  deleteThread(threadId: string): Promise<RepositoryResult<null>>;
}

export function createConversationRepository(
  client: DatabaseClient,
): ConversationRepository {
  return {
    async listThreads(learnerId, limit = DEFAULT_THREAD_PAGE) {
      const page = decodeInput(
        limit,
        z.number().int().min(1).max(MAX_THREAD_PAGE),
      );
      if (!page.ok) return page;

      const outcome = await client
        .from(THREADS)
        .select("*")
        .eq("learner_id", learnerId)
        .order("updated_at", { ascending: false })
        .limit(page.data);

      return decodeRows(outcome, conversationThreadFromRow);
    },

    async getThread(threadId) {
      // RLS filters another learner's thread out entirely, so this returns
      // not_found. That is deliberate: distinguishing "not yours" from "does
      // not exist" would confirm the row exists to someone who cannot see it.
      const outcome = await client
        .from(THREADS)
        .select("*")
        .eq("id", threadId)
        .single();

      return decodeRow(outcome, conversationThreadFromRow);
    },

    async createThread(thread) {
      const input = decodeInput(thread, newThreadSchema);
      if (!input.ok) return input;

      const outcome = await client.rpc("start_conversation_thread", {
        p_title: input.data.title,
        p_topic: input.data.topic,
        p_mode: input.data.mode,
      });

      return decodeRow(outcome, conversationThreadFromRow);
    },

    async updateThread(threadId, update) {
      const input = decodeInput(update, threadUpdateSchema);
      if (!input.ok) return input;

      // No learner id in the filter: the update runs as the signed-in learner
      // and Row Level Security decides which row is reachable. A thread that
      // is not theirs matches nothing and reads as not found.
      const outcome = await client
        .from(THREADS)
        .update(input.data)
        .eq("id", threadId)
        .select("*")
        .single();

      return decodeRow(outcome, conversationThreadFromRow);
    },

    async deleteThread(threadId) {
      // Nothing hangs off a thread any more: what was said in it was never
      // written down, so deleting one deletes exactly one row.
      const outcome = await client
        .from(THREADS)
        .delete()
        .eq("id", threadId)
        .select("id");

      if (outcome.error) return decodeRow(outcome, z.never());

      const deleted = Array.isArray(outcome.data) ? outcome.data : [];
      // Nothing deleted means the thread was not the caller's, or was already
      // gone. Both read as not found; saying which would confirm a row exists
      // to someone who cannot see it.
      return deleted.length === 0 ? fail(repositoryError("not_found")) : ok(null);
    },
  };
}
