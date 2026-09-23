import type { CEFRLevel } from "@dp/domain/cefr";
import { gatewayFail, gatewayOk, type GatewayResult } from "./errors";
import {
  DETERMINISTIC_ONLY,
  ceilingsFor,
  routeFor,
  taskIdSchema,
  type TaskId,
  type Tier,
} from "@dp/domain/tasks";

/**
 * The task router.
 *
 * A task's tier and ceilings are read from the normative table, never accepted
 * from a caller. That is the whole job: it is a lookup, and it is a lookup
 * precisely so there is nowhere for "just this once, on the better model" to
 * live.
 */

export interface ResolvedRoute {
  readonly task: TaskId;
  readonly tier: Tier;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export function resolveTask(
  task: unknown,
  level?: CEFRLevel,
): GatewayResult<ResolvedRoute> {
  const parsed = taskIdSchema.safeParse(task);

  if (!parsed.success) {
    // Anything not in the table does not get to call a model. That includes
    // the work the routing document lists as deterministic: a pure function
    // that grew a prompt should fail here rather than quietly acquire a bill.
    return gatewayFail(
      "unknown_task",
      `${String(task)} is not in the routing table`,
    );
  }

  const ceilings = ceilingsFor(parsed.data, level);

  return gatewayOk({
    task: parsed.data,
    tier: routeFor(parsed.data).tier,
    maxInputTokens: ceilings.maxInputTokens,
    maxOutputTokens: ceilings.maxOutputTokens,
  });
}

const DETERMINISTIC = new Set<string>(DETERMINISTIC_ONLY);

export function isDeterministicOnly(name: string): boolean {
  return DETERMINISTIC.has(name);
}
