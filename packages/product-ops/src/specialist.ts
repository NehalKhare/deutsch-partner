import type { ZodType } from "zod";

import { parseModelJson } from "@dp/domain/evaluation";
import { callSpecFor } from "@dp/gateway/call-spec";
import type {
  CallContext,
  Citation,
  GatewayPrompt,
  ModelGateway,
} from "@dp/gateway/gateway";
import {
  behaviorPolicyFor,
  buildPrompt,
  fingerprint,
  promptEntry,
  repairInstruction,
  truncationRepairInstruction,
  versionedText,
  type RetrievedChunk,
} from "@dp/prompts";
import { nullLogger, type Logger } from "@dp/observability/logger";

/**
 * One structured product-ops call.
 *
 * All five agents in this directory are the same shape — assemble a catalogue
 * prompt, dispatch it through the gateway, validate what comes back, repair
 * once if it has to, give up as a typed value — so the shape lives here once
 * rather than five times. What differs between them is the entry, the schema,
 * and what they refuse to believe about the answer; that is what the modules
 * beside this one are for.
 *
 * The evaluator is the model this follows (lib/ai/evaluation/evaluate.ts).
 * Two differences, both because these calls are offline and nobody is
 * waiting: there is no deterministic triage to skip, and there is no salvage
 * pass — a partially valid proposal is not a proposal, and a partially valid
 * edit is not something to write to a file.
 */

/**
 * The routing document's rule: one repair, then the safe path. A second
 * failure is a model that cannot produce this shape today, and a third call
 * costs money to learn that again.
 */
export const MAX_REPAIR_ATTEMPTS = 1;

/** Long enough for a reasoning-tier call, short enough to fail a hung one. */
export const SPECIALIST_TIMEOUT_MS = 90_000;

export type SpecialistFailure =
  | "invalid_request"
  | "over_budget"
  | "model_unavailable"
  | "invalid_output";

export type SpecialistOutcome<T> =
  | {
      readonly status: "ok";
      readonly value: T;
      /** What the provider says it read. Empty for a call that searched nothing. */
      readonly citations: readonly Citation[];
      readonly attempts: number;
      readonly costEur: number;
    }
  | {
      readonly status: "failed";
      readonly reason: SpecialistFailure;
      /** A code or an issue path. Never a provider message or a payload. */
      readonly detail: string;
      readonly attempts: number;
      readonly costEur: number;
    };

export interface SpecialistDeps {
  readonly gateway: ModelGateway;
  readonly logger?: Logger;
}

export interface SpecialistRequest<T> {
  /** The catalogue entry's name. Its task, tier and ceilings come from there. */
  readonly prompt: string;
  readonly schema: ZodType<T>;
  /** Validated against the entry's own input schema before anything is sent. */
  readonly input: Record<string, unknown>;
  /** Untrusted context, fenced by the builder. */
  readonly knowledge?: readonly RetrievedChunk[];
  readonly context: CallContext;
}

/**
 * The user block.
 *
 * The entry's input schema names one field, and this renders it. A repair
 * instruction is appended rather than replacing anything, because the model
 * needs to see the request it is being asked to answer again.
 */
function userTextFor(
  input: Record<string, unknown>,
  repair: string | null,
): string {
  const body = Object.values(input)
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join("\n\n");

  return repair === null ? body : `${body}${repair}`;
}

export async function runSpecialist<T>(
  deps: SpecialistDeps,
  request: SpecialistRequest<T>,
): Promise<SpecialistOutcome<T>> {
  const logger = deps.logger ?? nullLogger;
  const entry = promptEntry(request.prompt);

  const validInput = entry.inputSchema.safeParse(request.input);
  if (!validInput.success) {
    // Before any dispatch: a missing or empty variable is this layer's
    // mistake, and paying a model to discover it would be absurd.
    return {
      status: "failed",
      reason: "invalid_request",
      detail: validInput.error.issues
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", "),
      attempts: 0,
      costEur: 0,
    };
  }

  const spec = callSpecFor(entry.task, {
    timeoutMs: SPECIALIST_TIMEOUT_MS,
    // Required for every non-conversation task, and the schema the reply is
    // actually validated against.
    outputSchema: request.schema,
  });
  if (!spec.ok) {
    return {
      status: "failed",
      reason: "invalid_request",
      detail: spec.failure,
      attempts: 0,
      costEur: 0,
    };
  }

  let repair: string | null = null;
  let costEur = 0;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS + 1; attempt += 1) {
    const built = buildPrompt(entry, {
      // Required by the build request's shape and rendered by none of these
      // entries: a product-ops run has no learner and no level. The entries
      // declare neither the learner_state nor the policy blocks, so none of
      // this reaches a provider.
      policy: behaviorPolicyFor({ cefr: "B1" }),
      cefr: "B1",
      learner: {
        effectiveLevel: { cefr: "B1", plus: false },
        miniLevel: 1,
        theme: "—",
        focus: "—",
        learningGoal: "—",
        interests: [],
        targetVocabulary: [],
        targetGrammar: [],
        dueVocabulary: [],
        recurringErrors: [],
        justMoved: null,
      },
      knowledge: [...(request.knowledge ?? [])],
      userMessage: userTextFor(request.input, repair),
    });

    if (!built.ok) {
      return {
        status: "failed",
        reason: built.reason === "over_budget" ? "over_budget" : "invalid_request",
        detail: built.reason,
        attempts: attempt - 1,
        costEur,
      };
    }

    const prompt: GatewayPrompt = {
      system: built.prompt.system,
      user: built.prompt.user,
      inputTokens: built.prompt.tokens.total,
    };

    const outcome = await deps.gateway.complete(spec.data, prompt, {
      ...request.context,
      prompt: {
        name: entry.name,
        version: entry.version,
        // The version's own text, not this call's: a fingerprint that moves
        // with the input records nothing about the prompt.
        fingerprint: fingerprint(versionedText(built.prompt)),
      },
    });

    if (!outcome.ok) {
      // A denial or a provider failure is not something a retry fixes, and
      // the gateway has already accounted for it.
      return {
        status: "failed",
        reason:
          outcome.failure === "budget_denied" || outcome.failure === "ceiling_denied"
            ? "over_budget"
            : "model_unavailable",
        detail: outcome.failure,
        attempts: attempt,
        costEur,
      };
    }

    costEur += outcome.data.costEur;

    if (outcome.data.truncated) {
      // The ceiling cut the reply off. Valid JSON that does not finish is no
      // object, and the parser would only say so less precisely; the repair
      // for it is to ask for less, not for the same thing again.
      // The count says which kind of cut-off this was: output at the ceiling
      // with a short visible answer means the model thought the ceiling away.
      logger.warn("productops.output_truncated", {
        promptName: entry.name,
        attempt,
        tier: outcome.data.tier,
        outputTokens: outcome.data.outputTokens,
        requestId: request.context.requestId,
      });

      if (attempt > MAX_REPAIR_ATTEMPTS) {
        return {
          status: "failed",
          reason: "invalid_output",
          detail: "truncated",
          attempts: attempt,
          costEur,
        };
      }

      repair = truncationRepairInstruction();
      continue;
    }

    const parsed = parseModelJson(outcome.data.text, request.schema);
    if (parsed.ok) {
      return {
        status: "ok",
        value: parsed.data,
        citations: outcome.data.citations,
        attempts: attempt,
        costEur,
      };
    }

    // Issue paths only, capped, and never the payload: the reply can quote a
    // web page back, and a log is not where that goes.
    logger.warn("productops.output_invalid", {
      promptName: entry.name,
      attempt,
      reason: parsed.reason,
      issues: parsed.issues.slice(0, 8).join(", "),
      requestId: request.context.requestId,
    });

    if (attempt > MAX_REPAIR_ATTEMPTS) {
      return {
        status: "failed",
        reason: "invalid_output",
        detail: parsed.issues.slice(0, 8).join(", "),
        attempts: attempt,
        costEur,
      };
    }

    repair = repairInstruction(parsed.issues);
  }

  // Unreachable: the loop returns on every path. Present because a function
  // that can fall off the end is one a refactor can quietly break.
  return {
    status: "failed",
    reason: "invalid_output",
    detail: "exhausted",
    attempts: MAX_REPAIR_ATTEMPTS + 1,
    costEur,
  };
}
