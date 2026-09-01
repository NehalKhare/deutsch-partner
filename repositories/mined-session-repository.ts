import { z } from "zod";

import type { RepositoryResult } from "@/repositories/errors";
import { decodeRows } from "@/repositories/result";
import type { DatabaseClient } from "@/repositories/types";

const TABLE = "trainer_mined_sessions";

/**
 * The post-session miner's idempotency guard.
 *
 * One row per mined session, claimed with an insert before anything is
 * written: a duplicated completion turn — a retry, a resent message — finds
 * the row already there and mines nothing twice. RLS scopes the table to the
 * signed-in learner, and the row holds keys and a timestamp, never content.
 */
export interface MinedSessionRepository {
  /** Claims the key. False means another run already holds it. */
  claim(learnerId: string, sessionKey: string): Promise<RepositoryResult<boolean>>;
}

export function createMinedSessionRepository(
  client: DatabaseClient,
): MinedSessionRepository {
  return {
    async claim(learnerId, sessionKey) {
      // Insert-if-absent, atomically: the row coming back means this run won
      // the claim; an empty result means somebody already had it.
      const outcome = await client
        .from(TABLE)
        .upsert(
          { learner_id: learnerId, session_key: sessionKey },
          { onConflict: "learner_id,session_key", ignoreDuplicates: true },
        )
        .select("session_key");

      const rows = decodeRows(outcome, z.object({ session_key: z.string() }));
      if (!rows.ok) return rows;

      return { ok: true, data: rows.data.length > 0 };
    },
  };
}
