"use server";

import { redirect } from "next/navigation";

import { parseOnboardingForm } from "@/lib/onboarding/input";
import type { OnboardingFormState } from "@/lib/onboarding/form-state";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import { createOnboardingRepository } from "@/repositories/onboarding-repository";
import type { DatabaseClient } from "@/repositories/types";

export async function completeOnboardingAction(
  _previous: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  // Establishes that there is a session. The database function reads the
  // learner id itself, so nothing identifying is passed from here.
  await requireAuthenticatedUserId();

  const parsed = parseOnboardingForm(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.message };
  }

  const supabase = await createServerSupabaseClient();
  const repository = createOnboardingRepository(
    supabase as unknown as DatabaseClient,
  );

  const result = await repository.complete(parsed.data);
  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }

  redirect("/dashboard");
}
