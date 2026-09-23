import { z } from "zod";

import type { LearnerError } from "@dp/domain/learner-error";
import { errorObservationSchema } from "@dp/domain/learner-error";
import type { RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import { learnerErrorFromRow } from "./rows";
import type { DatabaseClient } from "./types";

const ERRORS = "learner_errors";

export interface LearnerErrorRepository {
  /** Folds one observation into the learner's aggregate. Returns its id. */
  record(observation: unknown): Promise<RepositoryResult<string>>;
  listForLearner(
    learnerId: string,
    limit: number,
  ): Promise<RepositoryResult<LearnerError[]>>;
  listUnresolved(
    learnerId: string,
    limit: number,
  ): Promise<RepositoryResult<LearnerError[]>>;
  markResolved(errorId: string): Promise<RepositoryResult<LearnerError>>;
}

export function createLearnerErrorRepository(
  client: DatabaseClient,
): LearnerErrorRepository {
  return {
    async record(observation) {
      const parsed = decodeInput(observation, errorObservationSchema);
      if (!parsed.ok) return parsed;

      // A database function rather than read-then-write: counting has to be
      // atomic, and there is no learner id argument because the function
      // reads it from the verified session.
      const outcome = await client.rpc("record_learner_error", {
        p_error_type: parsed.data.errorType,
        p_pattern: parsed.data.pattern,
        p_utterance: parsed.data.utterance ?? null,
        p_observed_at: parsed.data.observedAt.toISOString(),
      });

      return decodeRow(outcome, z.uuid());
    },

    async listForLearner(learnerId, limit) {
      const outcome = await client
        .from(ERRORS)
        .select("*")
        .eq("learner_id", learnerId)
        .order("occurrence_count", { ascending: false })
        .limit(limit);

      return decodeRows(outcome, learnerErrorFromRow);
    },

    async listUnresolved(learnerId, limit) {
      // Ordered to match the partial index on (learner_id, occurrence_count)
      // where not resolved, which is the review engine's hot query.
      const outcome = await client
        .from(ERRORS)
        .select("*")
        .eq("learner_id", learnerId)
        .eq("resolved", false)
        .order("occurrence_count", { ascending: false })
        .limit(limit);

      return decodeRows(outcome, learnerErrorFromRow);
    },

    async markResolved(errorId) {
      // No learner id in the filter: the update runs as the signed-in learner
      // and Row Level Security decides which row is reachable.
      const outcome = await client
        .from(ERRORS)
        .update({ resolved: true })
        .eq("id", errorId)
        .select("*")
        .single();

      return decodeRow(outcome, learnerErrorFromRow);
    },
  };
}
