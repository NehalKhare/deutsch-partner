import { z, type ZodType } from "zod";

import { cefrLevelSchema, type CEFRLevel } from "@dp/domain/cefr";
import { planCodeSchema, type PlanCode } from "@dp/domain/plans";
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
 *
 * So is the plan. It is on the spec because the plan decides the tier, and a
 * spec validated without it could only be checked against the row: a free
 * learner's mid-tier spec would look like a caller choosing mid. With it, the
 * tier must be the plan's own and the ceilings must fit the plan's.
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
    /** Absent for a call with no plan, which then validates exactly as before plans. */
    plan: planCodeSchema.optional(),
  })
  .superRefine((spec, ctx) => {
    const route = resolveTask(spec.task, undefined, spec.plan);
    if (!route.ok) return;

    if (spec.tier !== route.data.tier) {
      const on = spec.plan ? ` on the ${spec.plan} plan` : "";
      ctx.addIssue({
        code: "custom",
        path: ["tier"],
        message: `${spec.task} routes to ${route.data.tier}${on}; the tier is derived from the task, not chosen`,
      });
    }

    // Unnarrowed by level: the largest this plan reaches at any level, which a
    // domain test holds at or under the row. Not the row itself — the row is
    // premium's maximum, and a spec with no plan, or a free one, carrying
    // premium's context is exactly what this check exists to refuse.
    const table = ceilingsFor(spec.task, undefined, spec.plan);

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
  plan: planCodeSchema.optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
  outputSchema: z.custom<ZodType>((value) => value instanceof z.ZodType).optional(),
});

export interface CallSpecOptions {
  readonly level?: CEFRLevel;
  /**
   * The learner's plan, resolved on the server from entitlement rows. Never
   * read from a request body, a header or a cookie. It selects a route the
   * table already holds; it is not a way to ask for a better one.
   */
  readonly plan?: PlanCode;
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
  // Parsed before the lookup so that only a validated level and plan reach
  // it, and reported after it so an unknown task still fails as one.
  const parsedOptions = callSpecOptionsSchema.safeParse(options);
  const valid = parsedOptions.success ? parsedOptions.data : undefined;

  const route = resolveTask(task, valid?.level, valid?.plan);
  if (!route.ok) return route;

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
    // Only when there is one, so a spec with no plan is the same object it
    // was before plans existed.
    ...(parsedOptions.data.plan ? { plan: parsedOptions.data.plan } : {}),
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
