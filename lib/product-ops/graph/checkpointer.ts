import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";

import type { ProductOpsRepository } from "@/repositories/product-ops-repository";
import type { CheckpointRow } from "@/repositories/product-ops-rows";

/**
 * The graph's checkpoint saver, over the product-ops repository.
 *
 * LangGraph's contract, implemented in about the lines MemorySaver takes, and
 * for a reason: the library's own Postgres saver wants its own connection
 * string and manages its own schema outside supabase/migrations, which the
 * migration discipline and the secret-key-only rule both forbid. Going through
 * the repository keeps the checkpoint tables behind the same client, the same
 * Zod envelope and the same RLS story as the other nine.
 *
 * Blobs are the serialiser's own bytes, base64. Nothing here reads inside
 * them. What a checkpoint carries is control flow and identifiers — the state
 * in lib/product-ops/graph/state.ts — never a proposal, a PRD or a plan, and
 * the retention rule follows from that: a run's checkpoints are a cache of its
 * progress, and losing them means resuming from the recorded stage.
 *
 * Repository failures throw. The graph treats a saver that cannot persist as
 * a run that cannot continue, which is the fail-closed reading: a run that
 * carried on without a checkpoint would be one that could not be resumed.
 */

const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const decode = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64"));

function threadIdOf(config: RunnableConfig): string {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("the product-ops graph needs a thread_id: the run id");
  }
  return threadId;
}

function namespaceOf(config: RunnableConfig): string {
  const ns = config.configurable?.checkpoint_ns;
  return typeof ns === "string" ? ns : "";
}

export class ProductOpsCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly runs: ProductOpsRepository) {
    super();
  }

  private async tupleFrom(
    row: CheckpointRow,
    config: RunnableConfig,
  ): Promise<CheckpointTuple> {
    const writes = await this.runs.listCheckpointWrites({
      threadId: row.threadId,
      checkpointNs: row.checkpointNs,
      checkpointId: row.checkpointId,
    });
    if (!writes.ok) throw new Error(`checkpoint writes unreadable: ${writes.error.kind}`);

    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      writes.data.map(
        async (write): Promise<CheckpointPendingWrite> => [
          write.taskId,
          write.channel,
          await this.serde.loadsTyped(write.valueType, decode(write.value)),
        ],
      ),
    );

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: row.threadId,
          checkpoint_ns: row.checkpointNs,
          checkpoint_id: row.checkpointId,
        },
      },
      checkpoint: (await this.serde.loadsTyped(
        row.checkpointType,
        decode(row.checkpoint),
      )) as Checkpoint,
      metadata: (await this.serde.loadsTyped(
        row.metadataType,
        decode(row.metadata),
      )) as CheckpointMetadata,
      pendingWrites,
    };

    if (row.parentId !== null) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.threadId,
          checkpoint_ns: row.checkpointNs,
          checkpoint_id: row.parentId,
        },
      };
    }

    // The config the caller passed is what the caller keys on, so it is
    // returned when it named a checkpoint; otherwise the row's own.
    return config.configurable?.checkpoint_id ? { ...tuple, config } : tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const checkpointId = getCheckpointId(config);
    const found = await this.runs.getCheckpoint({
      threadId: threadIdOf(config),
      checkpointNs: namespaceOf(config),
      ...(checkpointId ? { checkpointId } : {}),
    });
    if (!found.ok) throw new Error(`checkpoint unreadable: ${found.error.kind}`);
    if (found.data === null) return undefined;

    return this.tupleFrom(found.data, config);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const before = options?.before ? getCheckpointId(options.before) : undefined;
    const listed = await this.runs.listCheckpoints({
      threadId: threadIdOf(config),
      checkpointNs: namespaceOf(config),
      ...(before ? { before } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    });
    if (!listed.ok) throw new Error(`checkpoints unreadable: ${listed.error.kind}`);

    for (const row of listed.data) {
      yield await this.tupleFrom(row, {
        configurable: {
          thread_id: row.threadId,
          checkpoint_ns: row.checkpointNs,
          checkpoint_id: row.checkpointId,
        },
      });
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    // Versions are inside the checkpoint already; the contract passes them
    // for savers that index by them, which this one does not.
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = threadIdOf(config);
    const checkpointNs = namespaceOf(config);
    const prepared = copyCheckpoint(checkpoint);

    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] =
      await Promise.all([
        this.serde.dumpsTyped(prepared),
        this.serde.dumpsTyped(metadata),
      ]);

    const parent = config.configurable?.checkpoint_id;
    const stored = await this.runs.putCheckpoint({
      threadId,
      checkpointNs,
      checkpointId: checkpoint.id,
      parentId: typeof parent === "string" && parent.length > 0 ? parent : null,
      checkpointType,
      checkpoint: encode(checkpointBytes),
      metadataType,
      metadata: encode(metadataBytes),
    });
    if (!stored.ok) throw new Error(`checkpoint not stored: ${stored.error.kind}`);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const checkpointId = config.configurable?.checkpoint_id;
    if (typeof checkpointId !== "string" || checkpointId.length === 0) {
      throw new Error("pending writes need the checkpoint they belong to");
    }

    const rows = await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [valueType, bytes] = await this.serde.dumpsTyped(value);
        return {
          taskId,
          // Special channels (errors, interrupts) map to negative indices so
          // they never collide with an ordinary write's position.
          idx: WRITES_IDX_MAP[channel] ?? idx,
          channel,
          valueType,
          value: encode(bytes),
        };
      }),
    );

    const stored = await this.runs.putCheckpointWrites({
      threadId: threadIdOf(config),
      checkpointNs: namespaceOf(config),
      checkpointId,
      writes: rows,
    });
    if (!stored.ok) throw new Error(`checkpoint writes not stored: ${stored.error.kind}`);
  }

  async deleteThread(threadId: string): Promise<void> {
    const deleted = await this.runs.deleteCheckpoints(threadId);
    if (!deleted.ok) throw new Error(`checkpoints not deleted: ${deleted.error.kind}`);
  }
}
