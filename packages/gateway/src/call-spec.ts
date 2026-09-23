import { z, type ZodType } from "zod";

import { cefrLevelSchema, type CEFRLevel } from "@dp/domain/cefr";
import { gatewayFail, gatewayOk, type GatewayResult } from "./errors";
import { resolveTask } from "./router";
import { ceilingsFor, taskIdSchema, tierSchema, type TaskId } from "@dp/domain/tasks";

/**
 * The call spec.
 *
 * Ceilings are required fields with no default. A default is how a runaway
 * bill happens: somebody adds a task, forgets the ceiling, and the provider's
 * own maximum — often tens of thousands of tokens — quietly applies instead.
 * Making the field required moves that mistake from production to a type error.
 *
 * The tier is on the spec but is not the caller's to choose. It is written
 * here so the dispatcher and the ledger can read it without re-deriving it,
 * and validation rejects any value that disagrees with the routing table.
 */

/** The only tasks allowed to return free text. Everything else is schema-bound. */
export const CONVERSATION_TASKS: ReadonlySet<TaskId> = new Set<TaskId>([
  "conversation.turn",
  "conversation.repair",
]);

/** Long enough for a slow strong-tier turn, short enough to fail a hung one. */
const MAX_TIMEOUT_MS = 120_000;

export const modelCallSpecSchema = z
  .strictObject({
    task: taskIdSchema,
    tier: tierSchema,
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    /**
     * Required for every non-conversation task, because unvalidated model
     * output is never executed or stored (guardrails S12). Carried as an
     * opaque Zod type: the gateway validates with it, and never serialises it.
     */
    outputSchema: z.custom<ZodType>((value) => value instanceof z.ZodType).optional(),
  })
  .superRefine((spec, ctx) => {
    const route = resolveTask(spec.task);
    if (!route.ok) return;

    if (spec.tier !== route.data.tier) {
      ctx.addIssue({
        code: "custom",
        path: ["tier"],
        message: `${spec.task} routes to ${route.data.tier}; the tier is derived from the task, not chosen`,
      });
    }

    // The unnarrowed ceilings: a level narrows conversation.turn downward, so
    // the table's own figure is the true maximum for any level.
    const table = ceilingsFor(spec.task);

    if (spec.maxOutputTokens > table.maxOutputTokens) {
      ctx.addIssue({
        code: "custom",
        path: ["maxOutputTokens"],
        message: `${spec.task} may emit at most ${table.maxOutputTokens} tokens`,
      });
    }

    if (spec.maxInputTokens > table.maxInputTokens) {
      ctx.addIssue({
        code: "custom",
        path: ["maxInputTokens"],
        message: `${spec.task} may consume at most ${table.maxInputTokens} tokens`,
      });
    }

    if (!CONVERSATION_TASKS.has(spec.task) && spec.outputSchema === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["outputSchema"],
        message: `${spec.task} returns structured output and must declare a schema to validate it`,
      });
    }
  });

export type ModelCallSpec = z.infer<typeof modelCallSpecSchema>;

const callSpecOptionsSchema = z.strictObject({
  level: cefrLevelSchema.optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
  outputSchema: z.custom<ZodType>((value) => value instanceof z.ZodType).optional(),
});

export interface CallSpecOptions {
  readonly level?: CEFRLevel;
  readonly timeoutMs: number;
  readonly outputSchema?: ZodType;
}

/**
 * Builds a spec from a task.
 *
 * Note what the options do not include: a tier, a model, or a way to raise a
 * ceiling. Those come from the table. The strict option schema means an
 * attempt to pass one is a validation failure rather than a silently ignored
 * property.
 */
export function callSpecFor(
  task: unknown,
  options: CallSpecOptions,
): GatewayResult<ModelCallSpec> {
  const route = resolveTask(task, (options as CallSpecOptions | undefined)?.level);
  if (!route.ok) return route;

  const parsedOptions = callSpecOptionsSchema.safeParse(options);
  if (!parsedOptions.success) {
    return gatewayFail(
      "invalid_spec",
      parsedOptions.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }

  const parsed = modelCallSpecSchema.safeParse({
    task: route.data.task,
    tier: route.data.tier,
    maxInputTokens: route.data.maxInputTokens,
    maxOutputTokens: route.data.maxOutputTokens,
    timeoutMs: parsedOptions.data.timeoutMs,
    outputSchema: parsedOptions.data.outputSchema,
  });

  return parsed.success
    ? gatewayOk(parsed.data)
    : gatewayFail(
        "invalid_spec",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; "),
      );
}

/**
 * Shortens an output ceiling under budget pressure.
 *
 * One direction only. Degradation that could raise a ceiling would be an
 * escalation wearing a degradation's name.
 */
export function withLoweredOutputCeiling(
  spec: ModelCallSpec,
  maxOutputTokens: number,
): ModelCallSpec {
  return {
    ...spec,
    maxOutputTokens: Math.min(spec.maxOutputTokens, Math.max(1, maxOutputTokens)),
  };
}
