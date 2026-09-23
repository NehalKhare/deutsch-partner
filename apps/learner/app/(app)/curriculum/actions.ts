"use server";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";

import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { parseMiniLevelForm } from "@/lib/curriculum/practise";
import {
  INITIAL_SWITCH_LEVEL_STATE,
  parseSwitchLevelForm,
  switchLevelError,
  type SwitchLevelState,
} from "@/lib/curriculum/switch-level";
import { getMiniLevel } from "@dp/learning/mini-levels";
import { switchToLevel, switchToMiniLevel } from "@dp/learning/progression";
import { createConversationRepository } from "@dp/db/conversation-repository";
import { createLearnerRepository } from "@dp/db/learner-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";

/**
 * Moves the learner to a level they chose.
 *
 * Where they land is a pure function over their own state — the routing
 * document names level advancement gating as work that must never be a model
 * call, and choosing a level is the same kind of decision. They return to
 * where they left that level rather than to the front of it.
 *
 * The read and the write both run as the signed-in learner, so Row Level
 * Security decides whose state is reachable; the learner id in the row is
 * theirs because it is the only one they can read.
 */
export async function switchLevelAction(
  _previous: SwitchLevelState,
  formData: FormData,
): Promise<SwitchLevelState> {
  const learnerId = await requireAuthenticatedUserId();
  const parsed = parseSwitchLevelForm(formData);
  if (!parsed.success) return switchLevelError("invalid_input");

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const learners = createLearnerRepository(supabase);

  const current = await learners.getState(learnerId);
  if (!current.ok) return switchLevelError("unavailable");

  const moved = switchToLevel(current.data, parsed.level);
  // Already there. Not an error, and not a write either: a row that changes
  // nothing still bumps updated_at and still says something happened.
  if (!moved) return INITIAL_SWITCH_LEVEL_STATE;

  const saved = await learners.upsertState(moved.state);
  if (!saved.ok) return switchLevelError("unavailable");

  actionLogger().info("learner.level_changed", {
    userIdHash: pseudonymOrUnavailable(learnerId),
    level: parsed.level,
    fromMiniLevel: moved.from,
    toMiniLevel: moved.to,
  });

  // Everything that reads a level: the dashboard's header, the curriculum
  // page's "you are here", and the level a new thread would be opened at.
  revalidatePath("/curriculum");
  revalidatePath("/dashboard");

  return INITIAL_SWITCH_LEVEL_STATE;
}

/**
 * Moves the learner to the exact mini-level whose row they pressed.
 *
 * The move is the same pure function every other move goes through, and it
 * marks nothing as skipped: standing somewhere on your own syllabus is a
 * choice, not a walkout. The write runs as the signed-in learner, so Row
 * Level Security decides whose state is reachable.
 *
 * A plain form action rather than useActionState: seventy rows each carrying
 * their own client-side form state would be seventy hydrated components for a
 * button whose failure mode is "nothing changed, try again".
 */
export async function chooseMiniLevelAction(formData: FormData): Promise<void> {
  const learnerId = await requireAuthenticatedUserId();
  const parsed = parseMiniLevelForm(formData);
  if (!parsed.success) redirect("/curriculum");

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const learners = createLearnerRepository(supabase);

  const current = await learners.getState(learnerId);
  if (!current.ok) redirect("/curriculum");

  const moved = switchToMiniLevel(current.data, parsed.miniLevel);
  if (moved) {
    const saved = await learners.upsertState(moved.state);
    if (!saved.ok) {
      // A failed write must not read as a successful move: back to the band
      // they are actually in, with a notice the page can say out loud.
      redirect(
        `/curriculum?level=${current.data.effectiveLevel.cefr}&notice=move_failed`,
      );
    }

    actionLogger().info("learner.level_changed", {
      userIdHash: pseudonymOrUnavailable(learnerId),
      level: moved.state.effectiveLevel.cefr,
      fromMiniLevel: moved.from,
      toMiniLevel: moved.to,
    });
  }

  revalidatePath("/curriculum");
  revalidatePath("/dashboard");
  // Back to the band they now stand in, with the row they chose on screen.
  redirect(
    `/curriculum?level=${(moved ?? { state: current.data }).state.effectiveLevel.cefr}`,
  );
}

/**
 * Moves the learner to the pressed mini-level and opens a conversation at it.
 *
 * The order matters: the thread function reads the level from the learner's
 * own record, so the move has to be written before the thread exists or the
 * conversation would carry the level they just left.
 */
export async function practiseMiniLevelAction(formData: FormData): Promise<void> {
  const learnerId = await requireAuthenticatedUserId();
  const parsed = parseMiniLevelForm(formData);
  if (!parsed.success) redirect("/curriculum");

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const learners = createLearnerRepository(supabase);

  const current = await learners.getState(learnerId);
  if (!current.ok) redirect("/curriculum");

  const moved = switchToMiniLevel(current.data, parsed.miniLevel);
  if (moved) {
    const saved = await learners.upsertState(moved.state);
    // A conversation at the wrong level is worse than no move at all: stop
    // here rather than open a thread that contradicts the button.
    if (!saved.ok) {
      redirect(
        `/curriculum?level=${current.data.effectiveLevel.cefr}&notice=move_failed`,
      );
    }

    actionLogger().info("learner.level_changed", {
      userIdHash: pseudonymOrUnavailable(learnerId),
      level: moved.state.effectiveLevel.cefr,
      fromMiniLevel: moved.from,
      toMiniLevel: moved.to,
    });
    revalidatePath("/curriculum");
    revalidatePath("/dashboard");
  }

  const level = getMiniLevel(parsed.miniLevel);
  const created = await createConversationRepository(supabase).createThread({
    title: level.theme,
    topic: level.focus.slice(0, 64),
    mode: "free_chat",
  });

  redirect(
    created.ok
      ? `/chat/${created.data.id}`
      : `/curriculum?level=${moved ? moved.state.effectiveLevel.cefr : current.data.effectiveLevel.cefr}&notice=practise_failed`,
  );
}
