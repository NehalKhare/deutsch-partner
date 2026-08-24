import { MAX_MINI_LEVEL, miniLevelSchema } from "@/domain/cefr";
import type { LevelPerformance } from "@/domain/performance";
import { ok, type RepositoryResult } from "@/repositories/errors";
import { decodeInput, decodeRow, decodeRows } from "@/repositories/result";
import { levelPerformanceFromRow } from "@/repositories/rows";
import type { DatabaseClient } from "@/repositories/types";

const PERFORMANCES = "level_performances";

/**
 * The per-level tally of evaluated turns.
 *
 * This is the long-term memory a conversation leaves behind — the words
 * themselves never reach the database. Recording goes through a database
 * function so two turns finishing at once count as two: a read-modify-write
 * here would lose one of them, and the tally is what advancement is gated on.
 *
 * recordTurn takes no learner id. The database stamps the row from the
 * verified session, so a caller cannot pad someone else's record.
 */
export interface PerformanceRepository {
  recordTurn(
    miniLevel: number,
    strong: boolean,
  ): Promise<RepositoryResult<LevelPerformance>>;
  getForLevel(
    learnerId: string,
    miniLevel: number,
  ): Promise<RepositoryResult<LevelPerformance | null>>;
  /** Every level with a tally, for the pages that show the whole path. */
  listForLearner(
    learnerId: string,
  ): Promise<RepositoryResult<LevelPerformance[]>>;
}

export function createPerformanceRepository(
  client: DatabaseClient,
): PerformanceRepository {
  return {
    async recordTurn(miniLevel, strong) {
      const level = decodeInput(miniLevel, miniLevelSchema);
      if (!level.ok) return level;

      const outcome = await client.rpc("record_level_turn", {
        p_mini_level: level.data,
        p_strong: strong === true,
      });

      return decodeRow(outcome, levelPerformanceFromRow);
    },

    async getForLevel(learnerId, miniLevel) {
      const level = decodeInput(miniLevel, miniLevelSchema);
      if (!level.ok) return level;

      const outcome = await client
        .from(PERFORMANCES)
        .select("*")
        .eq("learner_id", learnerId)
        .eq("mini_level", level.data)
        .limit(1);

      const rows = decodeRows(outcome, levelPerformanceFromRow);
      if (!rows.ok) return rows;

      // No row is not an error: it is a level nobody has spoken at yet.
      return ok(rows.data[0] ?? null);
    },

    async listForLearner(learnerId) {
      const outcome = await client
        .from(PERFORMANCES)
        .select("*")
        .eq("learner_id", learnerId)
        .order("mini_level", { ascending: true })
        // One row per mini-level; the path itself is the bound.
        .limit(MAX_MINI_LEVEL);

      return decodeRows(outcome, levelPerformanceFromRow);
    },
  };
}
