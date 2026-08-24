import {
  learnerProfileSchema,
  learnerStateSchema,
  type LearnerProfile,
  type LearnerState,
} from "@/domain/learner";
import type { RepositoryResult } from "@/repositories/errors";
import {
  learnerStateFromRow,
  learnerStateToRow,
  profileFromRow,
  profileToRow,
} from "@/repositories/rows";
import { decodeInput, decodeRow } from "@/repositories/result";
import type { DatabaseClient } from "@/repositories/types";

const PROFILES = "profiles";
const LEARNER_STATES = "learner_states";

export interface LearnerRepository {
  getProfile(learnerId: string): Promise<RepositoryResult<LearnerProfile>>;
  upsertProfile(
    profile: LearnerProfile,
  ): Promise<RepositoryResult<LearnerProfile>>;
  getState(learnerId: string): Promise<RepositoryResult<LearnerState>>;
  upsertState(state: LearnerState): Promise<RepositoryResult<LearnerState>>;
}

export function createLearnerRepository(
  client: DatabaseClient,
): LearnerRepository {
  return {
    async getProfile(learnerId) {
      const outcome = await client
        .from(PROFILES)
        .select("*")
        .eq("id", learnerId)
        .single();

      return decodeRow(outcome, profileFromRow);
    },

    async upsertProfile(profile) {
      // Validate before touching the database: a malformed profile should
      // never reach a constraint, and the caller gets a precise error.
      const input = decodeInput(profile, learnerProfileSchema);
      if (!input.ok) return input;

      const outcome = await client
        .from(PROFILES)
        .upsert(profileToRow(input.data))
        .select("*")
        .single();

      return decodeRow(outcome, profileFromRow);
    },

    async getState(learnerId) {
      const outcome = await client
        .from(LEARNER_STATES)
        .select("*")
        .eq("learner_id", learnerId)
        .single();

      return decodeRow(outcome, learnerStateFromRow);
    },

    async upsertState(state) {
      const input = decodeInput(state, learnerStateSchema);
      if (!input.ok) return input;

      const outcome = await client
        .from(LEARNER_STATES)
        .upsert(learnerStateToRow(input.data))
        .select("*")
        .single();

      return decodeRow(outcome, learnerStateFromRow);
    },
  };
}
