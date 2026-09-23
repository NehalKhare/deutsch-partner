import "server-only";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import { createOnboardingRepository } from "@dp/db/onboarding-repository";
import type { DatabaseClient } from "@dp/db/types";

export const ONBOARDING_PATH = "/onboarding";
const DASHBOARD_PATH = "/dashboard";

async function onboardingStatus(learnerId: string) {
  const supabase = await createServerSupabaseClient();
  const repository = createOnboardingRepository(
    supabase as unknown as DatabaseClient,
  );

  return repository.getStatus(learnerId);
}

/**
 * Guards the authenticated app. A learner without a completed profile has no
 * level, no mini-level and no state for the app to work from.
 *
 * On a failed read the learner goes to onboarding: showing a dashboard built
 * from state we could not load is worse than asking them to confirm setup.
 */
export async function requireOnboarded(learnerId: string): Promise<void> {
  const status = await onboardingStatus(learnerId);

  if (!status.ok || !status.data.onboarded) redirect(ONBOARDING_PATH);
}

/**
 * Guards the onboarding page itself, so a finished learner is not asked again.
 *
 * The mirror of the rule above: on a failed read the learner stays on the
 * form, because bouncing them away from the one page that could repair their
 * state would strand them.
 */
export async function redirectIfOnboarded(learnerId: string): Promise<void> {
  const status = await onboardingStatus(learnerId);

  if (status.ok && status.data.onboarded) redirect(DASHBOARD_PATH);
}
