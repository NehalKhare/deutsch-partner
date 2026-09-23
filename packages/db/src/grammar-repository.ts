import { miniLevelSchema } from "@dp/domain/cefr";
import type { GrammarPattern } from "@dp/domain/grammar";
import type { RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import { grammarPatternFromRow } from "./rows";
import type { DatabaseClient } from "./types";

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
