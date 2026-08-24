"use server";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";

import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import {
  INITIAL_DELETE_THREAD_STATE,
  deleteThreadError,
  parseDeleteThreadForm,
  type DeleteThreadState,
} from "@/lib/chat/delete-thread";
import { getMiniLevel } from "@/learning/mini-levels";
import { createConversationRepository } from "@/repositories/conversation-repository";
import { createLearnerRepository } from "@/repositories/learner-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

/**
 * Opens a thread and sends the learner into it.
 *
 * The title and topic come from the learner's current mini-level rather than
 * from the form: a thread should say what it is about before anything has been
 * said in it, and the level knows that better than an empty text box does.
 *
 * Neither the level nor the owner is submitted. The database function reads
 * both from the verified session.
 */
export async function startThreadAction(): Promise<never> {
  const learnerId = await requireAuthenticatedUserId();
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;

  const state = await createLearnerRepository(supabase).getState(learnerId);
  if (!state.ok) redirect("/dashboard");

  const level = getMiniLevel(state.data.miniLevel);
  const created = await createConversationRepository(supabase).createThread({
    title: level.theme,
    topic: level.focus.slice(0, 64),
    mode: "free_chat",
  });

  redirect(created.ok ? `/chat/${created.data.id}` : "/dashboard");
}

/**
 * Deletes a conversation the learner owns.
 *
 * No learner id goes into the query. The delete runs as the signed-in learner
 * and Row Level Security decides which row is reachable, so somebody else's
 * thread id matches nothing and comes back as not found — the same answer a
 * thread that never existed gets. Nothing cascades, because nothing hangs off
 * a thread any more: what was said in it was never written down.
 *
 * What survives: the learner's vocabulary, their recorded mistakes, their
 * level, and the per-level tally of how their practice went. Those are
 * progress, not conversation, and nothing about them references a thread.
 * Deleting a chat is not a way to undo a fortnight of learning by accident.
 *
 * The usage ledger keeps its rows too. It holds a pseudonymous hash, a cost
 * and a now-dangling thread id, and it is append-only by database trigger —
 * financial history has to survive the thing it describes.
 *
 * Deleting your own data is a privileged operation, so it is audited
 * (security-observability-guardrails.md S24). The event carries the thread id
 * and a pseudonym, never a title and never a word anybody wrote.
 */
export async function deleteThreadAction(
  _previous: DeleteThreadState,
  formData: FormData,
): Promise<DeleteThreadState> {
  const learnerId = await requireAuthenticatedUserId();
  const parsed = parseDeleteThreadForm(formData);

  // A malformed id reads the same as somebody else's: both are "not here".
  if (!parsed.success) return deleteThreadError("not_found");

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const deleted = await createConversationRepository(supabase).deleteThread(
    parsed.threadId,
  );

  actionLogger().warn("chat.thread_deleted", {
    audit: true,
    threadId: parsed.threadId,
    userIdHash: pseudonymOrUnavailable(learnerId),
    outcome: deleted.ok ? "deleted" : deleted.error.kind,
  });

  if (!deleted.ok) {
    return deleteThreadError(
      deleted.error.kind === "not_found" ? "not_found" : "unavailable",
    );
  }

  // The only place in the product where an action changes what the page the
  // learner is standing on displays. Everything else redirects, which
  // refreshes on its own; a row vanishing in place does not.
  revalidatePath("/dashboard");

  return INITIAL_DELETE_THREAD_STATE;
}
