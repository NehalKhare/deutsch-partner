"use server";

import { revalidatePath } from "next/cache";

import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import {
  SETTINGS_SAVED,
  parseSettingsForm,
  settingsError,
  type SettingsFormState,
} from "@/lib/settings/input";
import { createLearnerRepository } from "@/repositories/learner-repository";
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

  // The dashboard greets the goal and the chat renders the preferences.
  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return SETTINGS_SAVED;
}
