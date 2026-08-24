import { z } from "zod";

import { uuidSchema } from "@/domain/primitives";

/**
 * Deleting a conversation.
 *
 * The schema, the state and the messages live here rather than beside the
 * action because a "use server" module may only export async functions, so a
 * constant or a type declared alongside them breaks the whole module at
 * runtime.
 *
 * The messages are the interesting part. "Not yours" and "no such thread" get
 * the same sentence on purpose: a learner who guesses somebody else's thread
 * id must not be told, by the wording of a failure, that it exists. Row Level
 * Security already makes the two indistinguishable in the database; saying so
 * differently in the browser would give it back.
 */

export const deleteThreadSchema = z.strictObject({ threadId: uuidSchema });

export const DELETE_THREAD_MESSAGES = {
  /** Covers a malformed id, somebody else's thread, and one already gone. */
  not_found: "That conversation is no longer here.",
  unavailable: "We could not delete that just now. Please try again.",
} as const;

export interface DeleteThreadState {
  readonly message: string | null;
  readonly status: "idle" | "error";
}

export const INITIAL_DELETE_THREAD_STATE: DeleteThreadState = {
  message: null,
  status: "idle",
};

export function deleteThreadError(
  kind: keyof typeof DELETE_THREAD_MESSAGES,
): DeleteThreadState {
  return { status: "error", message: DELETE_THREAD_MESSAGES[kind] };
}

export type DeleteThreadAction = (
  state: DeleteThreadState,
  formData: FormData,
) => Promise<DeleteThreadState>;

export type DeleteThreadParseResult =
  | { readonly success: true; readonly threadId: string }
  | { readonly success: false };

export function parseDeleteThreadForm(
  formData: FormData,
): DeleteThreadParseResult {
  const parsed = deleteThreadSchema.safeParse({
    threadId: formData.get("threadId"),
  });

  return parsed.success
    ? { success: true, threadId: parsed.data.threadId }
    : { success: false };
}
