import { z } from "zod";

import {
  isSafeToStoreAsMemory,
  learnerMemorySchema,
  type LearnerMemory,
} from "@/domain/memory";
import { fail, repositoryError, type RepositoryResult } from "@/repositories/errors";
import { decodeInput, decodeRow, decodeRows } from "@/repositories/result";
import { learnerMemoryFromRow } from "@/repositories/rows";
import type { DatabaseClient } from "@/repositories/types";

const MEMORIES = "learner_memories";

export interface MemoryRepository {
  listForLearner(
    learnerId: string,
    limit: number,
  ): Promise<RepositoryResult<LearnerMemory[]>>;
  insert(memory: LearnerMemory): Promise<RepositoryResult<LearnerMemory>>;
  delete(memoryId: string): Promise<RepositoryResult<null>>;
}

function memoryToRow(memory: LearnerMemory) {
  return {
    id: memory.id,
    learner_id: memory.learnerId,
    kind: memory.kind,
    content: memory.content,
    salience: memory.salience,
    learner_error_id:
      memory.kind === "recurring_error" ? memory.learnerErrorId : null,
  };
}

export function createMemoryRepository(
  client: DatabaseClient,
): MemoryRepository {
  return {
    async listForLearner(learnerId, limit) {
      const outcome = await client
        .from(MEMORIES)
        .select("*")
        .eq("learner_id", learnerId)
        .order("salience", { ascending: false })
        .limit(limit);

      return decodeRows(outcome, learnerMemoryFromRow);
    },

    async insert(memory) {
      const input = decodeInput(memory, learnerMemorySchema);
      if (!input.ok) return input;

      // The last gate before a credential becomes permanent. The extraction
      // prompt is told to avoid these, but a prompt is not a control
      // (security-observability-guardrails.md S15).
      if (!isSafeToStoreAsMemory(input.data.content)) {
        return fail(repositoryError("invalid_input"));
      }

      const outcome = await client
        .from(MEMORIES)
        .insert(memoryToRow(input.data))
        .select("*")
        .single();

      return decodeRow(outcome, learnerMemoryFromRow);
    },

    async delete(memoryId) {
      const id = decodeInput(memoryId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client.from(MEMORIES).delete().eq("id", id.data);

      return outcome.error
        ? fail(repositoryError("unavailable", outcome.error))
        : { ok: true, data: null };
    },
  };
}
