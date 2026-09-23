import { z } from "zod";

import {
  onboardingInputSchema,
  type OnboardingInput,
} from "@dp/domain/onboarding/input";
import {
  fail,
  mapDatabaseError,
  ok,
  repositoryError,
  type RepositoryResult,
} from "./errors";
import { decodeInput } from "./result";
import type { DatabaseClient } from "./types";

const PROFILES = "profiles";

const statusRowSchema = z.object({
  id: z.uuid(),
  onboarded_at: z.union([z.string(), z.date()]).nullable(),
});

export interface OnboardingStatus {
  readonly onboarded: boolean;
}

export interface OnboardingRepository {
  complete(input: OnboardingInput): Promise<RepositoryResult<null>>;
  getStatus(learnerId: string): Promise<RepositoryResult<OnboardingStatus>>;
}

export function createOnboardingRepository(
  client: DatabaseClient,
): OnboardingRepository {
  return {
    async complete(input) {
      const parsed = decodeInput(input, onboardingInputSchema);
      if (!parsed.ok) return parsed;

      // One database function rather than two writes: a profile without a
      // learner state is a broken account. Note there is no learner id
      // argument — the function reads it from the verified session, so this
      // call cannot be aimed at somebody else.
      const { error } = await client.rpc("complete_onboarding", {
        p_native_language: parsed.data.nativeLanguage,
        p_learning_goal: parsed.data.learningGoal,
        p_selected_level: parsed.data.selectedLevel,
        p_target_topics: parsed.data.targetTopics,
        p_interests: parsed.data.interests,
        p_input_preference: parsed.data.inputPreference,
        p_output_preference: parsed.data.outputPreference,
        p_correction_preference: parsed.data.correctionPreference,
      });

      return error ? fail(mapDatabaseError(error)) : ok(null);
    },

    async getStatus(learnerId) {
      const outcome = await client
        .from(PROFILES)
        .select("id, onboarded_at")
        .eq("id", learnerId)
        .maybeSingle();

      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      // No profile row yet: the learner signed up but has not onboarded.
      if (outcome.data === null) return ok({ onboarded: false });

      const parsed = statusRowSchema.safeParse(outcome.data);
      if (!parsed.success) return fail(repositoryError("invalid_data", parsed.error));

      return ok({ onboarded: parsed.data.onboarded_at !== null });
    },
  };
}
