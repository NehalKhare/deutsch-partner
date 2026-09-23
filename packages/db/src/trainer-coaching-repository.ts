import { z } from "zod";

import { isSafeToStoreAsMemory } from "@dp/domain/memory";
import {
  trainerCoachingProfileSchema,
  trainerFeedbackSchema,
  type TrainerCoachingProfile,
  type TrainerFeedback,
} from "@dp/domain/trainer-coaching";
import { fail, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import {
  trainerCoachingProfileFromRow,
  trainerCoachingProfileToRow,
  trainerFeedbackFromRow,
  trainerFeedbackToRow,
} from "./rows";
import type { DatabaseClient } from "./types";

const PROFILES = "trainer_coaching_profiles";
const FEEDBACK = "trainer_feedback";

/**
 * What the Trainer has learned about coaching one learner, and the votes it
 * learned it from.
 *
 * Two tables, both the learner's own under RLS. The profile is the current
 * position of every dial — one row, upserted, read at the top of every
 * trainer turn. The feedback table is the record: one row per vote with its
 * reasons, the tool receipt and an optional note in the learner's words, and
 * never a line of the reply it was about, because the transcript is
 * ephemeral by design and a feedback table that quoted it would be the
 * transcript table by another name.
 *
 * reset() is the learner's door out (guardrails S15): both tables, wholesale.
 */
export interface TrainerCoachingRepository {
  /** The learner's profile, or null for a learner who has never given feedback. */
  getProfile(learnerId: string): Promise<RepositoryResult<TrainerCoachingProfile | null>>;
  upsertProfile(
    profile: TrainerCoachingProfile,
  ): Promise<RepositoryResult<TrainerCoachingProfile>>;
  recordFeedback(feedback: TrainerFeedback): Promise<RepositoryResult<TrainerFeedback>>;
  /** The most recent notes the learner wrote, newest first. */
  listRecentNotes(learnerId: string, limit: number): Promise<RepositoryResult<string[]>>;
  /** Forgets everything: the dials and every vote behind them. */
  reset(learnerId: string): Promise<RepositoryResult<null>>;
}

export function createTrainerCoachingRepository(
  client: DatabaseClient,
): TrainerCoachingRepository {
  return {
    async getProfile(learnerId) {
      const id = decodeInput(learnerId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(PROFILES)
        .select("*")
        .eq("learner_id", id.data)
        .maybeSingle();

      if (outcome.error) return decodeRow(outcome, trainerCoachingProfileFromRow);
      if (outcome.data === null || outcome.data === undefined) {
        return { ok: true, data: null };
      }
      return decodeRow(outcome, trainerCoachingProfileFromRow);
    },

    async upsertProfile(profile) {
      const input = decodeInput(profile, trainerCoachingProfileSchema);
      if (!input.ok) return input;

      const outcome = await client
        .from(PROFILES)
        .upsert(trainerCoachingProfileToRow(input.data), { onConflict: "learner_id" })
        .select("*")
        .single();

      return decodeRow(outcome, trainerCoachingProfileFromRow);
    },

    async recordFeedback(feedback) {
      const input = decodeInput(feedback, trainerFeedbackSchema);
      if (!input.ok) return input;

      // The last gate before a learner's words become permanent, the same
      // one memories pass through: a note that looks like a credential is
      // refused outright rather than stored and redacted later.
      if (input.data.note !== null && !isSafeToStoreAsMemory(input.data.note)) {
        return fail(repositoryError("invalid_input"));
      }

      const outcome = await client
        .from(FEEDBACK)
        .insert(trainerFeedbackToRow(input.data))
        .select("*")
        .single();

      return decodeRow(outcome, trainerFeedbackFromRow);
    },

    async listRecentNotes(learnerId, limit) {
      const id = decodeInput(learnerId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(FEEDBACK)
        .select("note")
        .eq("learner_id", id.data)
        .neq("note", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      const rows = decodeRows(outcome, z.object({ note: z.string().nullable() }));
      if (!rows.ok) return rows;

      return {
        ok: true,
        data: rows.data.flatMap((row) => (row.note === null ? [] : [row.note])),
      };
    },

    async reset(learnerId) {
      const id = decodeInput(learnerId, z.uuid());
      if (!id.ok) return id;

      // Votes first, then the dials: a failure halfway leaves a profile with
      // no history behind it, which the next vote overwrites, rather than a
      // history whose profile is gone.
      const votes = await client.from(FEEDBACK).delete().eq("learner_id", id.data);
      if (votes.error) return fail(repositoryError("unavailable", votes.error));

      const profile = await client.from(PROFILES).delete().eq("learner_id", id.data);
      if (profile.error) return fail(repositoryError("unavailable", profile.error));

      return { ok: true, data: null };
    },
  };
}
