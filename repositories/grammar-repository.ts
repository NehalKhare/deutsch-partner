import { miniLevelSchema } from "@/domain/cefr";
import type { GrammarPattern } from "@/domain/grammar";
import type { RepositoryResult } from "@/repositories/errors";
import { decodeInput, decodeRow, decodeRows } from "@/repositories/result";
import { grammarPatternFromRow } from "@/repositories/rows";
import type { DatabaseClient } from "@/repositories/types";

const PATTERNS = "grammar_patterns";

export interface GrammarRepository {
  findByKey(key: string): Promise<RepositoryResult<GrammarPattern>>;
  findByKeys(keys: readonly string[]): Promise<RepositoryResult<GrammarPattern[]>>;
  listUpToMiniLevel(miniLevel: number): Promise<RepositoryResult<GrammarPattern[]>>;
}

export function createGrammarRepository(
  client: DatabaseClient,
): GrammarRepository {
  return {
    async findByKey(key) {
      const outcome = await client
        .from(PATTERNS)
        .select("*")
        .eq("key", key)
        .single();

      return decodeRow(outcome, grammarPatternFromRow);
    },

    async findByKeys(keys) {
      if (keys.length === 0) return { ok: true, data: [] };

      const outcome = await client.from(PATTERNS).select("*").in("key", keys);

      return decodeRows(outcome, grammarPatternFromRow);
    },

    async listUpToMiniLevel(miniLevel) {
      const level = decodeInput(miniLevel, miniLevelSchema);
      if (!level.ok) return level;

      const outcome = await client
        .from(PATTERNS)
        .select("*")
        .lte("mini_level", level.data)
        .order("mini_level", { ascending: true });

      return decodeRows(outcome, grammarPatternFromRow);
    },
  };
}
