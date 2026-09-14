"use server";

import { refresh, revalidatePath } from "next/cache";

import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import {
  SETTINGS_SAVED,
  parseSettingsForm,
  settingsError,
  type SettingsFormState,
} from "@/lib/settings/input";
import { createLearnerRepository } from "@/repositories/learner-repository";
import { createTrainerCoachingRepository } from "@/repositories/trainer-coaching-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

/**
 * Saves the profile settings.
 *
 * Merge, not replace: the form owns seven fields, and the profile's identity
 * and selected level are read from the row it is changing. Both the read and
 * the write run as the signed-in learner, so Row Level Security decides which
 * row that is.
 *
 * These values become prompt content and retrieval filters on every turn,
 * which is why the schema is a closed set with caps rather than free text —
 * and why saving is worth an audit line (what changed, never the words).
 */
export async function updateSettingsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const learnerId = await requireAuthenticatedUserId();

  const parsed = parseSettingsForm(formData);
  if (!parsed.success) return settingsError(parsed.message);

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const learners = createLearnerRepository(supabase);

  const current = await learners.getProfile(learnerId);
  if (!current.ok) {
    return settingsError("We could not load your profile. Please try again.");
  }

  const saved = await learners.upsertProfile({
    ...current.data,
    ...parsed.data,
  });
  if (!saved.ok) {
    return settingsError("We could not save that just now. Please try again.");
  }

  actionLogger().info("learner.settings_changed", {
    userIdHash: pseudonymOrUnavailable(learnerId),
    correctionPreference: parsed.data.correctionPreference,
    topics: parsed.data.targetTopics.length,
    interests: parsed.data.interests.length,
  });

  // Two different jobs, and using one for both was the bug behind "my
  // settings never save": they did save, and the form kept showing the old
  // values afterwards.
  //
  // refresh() re-renders the route the learner is looking at, which is the
  // only thing that puts the saved values back on their screen. This page is
  // fully dynamic — it holds no cached data — so revalidatePath had nothing
  // to invalidate here and left the client router's copy of the page in place.
  refresh();
  // The dashboard greets the goal, and it is a different path: invalidating it
  // is what makes the next visit re-render rather than replay what was cached.
  revalidatePath("/dashboard");

  return SETTINGS_SAVED;
}

/**
 * Forgets what the trainer learned from this learner's feedback.
 *
 * The dials and every vote behind them, as the signed-in learner, so RLS
 * decides whose rows those are. Guardrails S15 asks for exactly this door,
 * and S24 asks that walking through it be audited — which rows, never what
 * the votes said.
 */
export async function resetTrainerCoachingAction(
  _previous: SettingsFormState,
  _formData: FormData,
): Promise<SettingsFormState> {
  const learnerId = await requireAuthenticatedUserId();

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const coaching = createTrainerCoachingRepository(supabase);

  const cleared = await coaching.reset(learnerId);
  if (!cleared.ok) {
    return settingsError("We could not clear that just now. Please try again.");
  }

  actionLogger().info("trainer.coaching_reset", {
    audit: true,
    userIdHash: pseudonymOrUnavailable(learnerId),
  });

  refresh();

  return {
    status: "saved",
    message: "Forgotten. Your next session starts from the defaults.",
  };
}
