import { z } from "zod";

import {
  HISTORY_WINDOW,
  MAX_MESSAGE_LENGTH,
  transcriptMessageSchema,
} from "@dp/domain/conversation";
import type { PlanCode } from "@dp/domain/plans";
import { nonEmptyTextSchema, uuidSchema } from "@dp/domain/primitives";
import {
  TRAILER_DELIMITER,
  encodeChatTrailer,
  type ChatTrailer,
} from "@/lib/api/chat-trailer";
import { allowanceRenewsAt } from "@/lib/billing/allowance";
import type { GraphDeps } from "@/lib/graph/nodes";
import { runTurn, type TurnAdmission } from "@/lib/graph/turn";
import type { TurnInput } from "@/lib/graph/state";
import { nullLogger, type Logger } from "@dp/observability/logger";

/**
 * The chat endpoint's logic, with the framework left outside.
 *
 * Everything here is a pure function of a parsed body and an injected set of
 * dependencies, so the route handler is thirty lines of Next.js and this is
 * what the tests drive. A route that mixes header parsing with orchestration
 * can only be tested by standing up a server.
 *
 * The order is the one the guardrails set out (S5): authenticate, authorize,
 * validate, rate limit, do the work, sanitise the logging. Authentication
 * happens in the handler because it needs the request's cookies; everything
 * from validation onwards happens here.
 */

/**
 * The transcript lives in the learner's browser and nowhere else, so each
 * turn carries its own recent history. Capped at the window the prompt would
 * use anyway — a longer claim is rejected rather than trimmed, like every
 * other over-limit input — and restricted to the two speaking roles, so a
 * body cannot smuggle a system line into the prompt.
 */
export const chatRequestSchema = z.strictObject({
  threadId: uuidSchema,
  message: nonEmptyTextSchema(MAX_MESSAGE_LENGTH),
  history: z.array(transcriptMessageSchema).max(HISTORY_WINDOW).default([]),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const CHAT_ERRORS = [
  "unauthenticated",
  "invalid_body",
  "rate_limited",
  "learner_unavailable",
  "thread_unavailable",
  "generation_failed",
  // The plan's three (lib/billing/refusal.ts). Answers rather than faults: the
  // page shows them as an upgrade prompt, with the learner's words kept.
  "plan_required",
  "quota_exhausted",
  "budget_exhausted",
] as const;

export type ChatError = (typeof CHAT_ERRORS)[number];

/**
 * What a learner is told, and the status that carries it.
 *
 * Never a stack trace, never a provider message, never a reason that would
 * tell an attacker whether a thread id exists (guardrails S25).
 */
const RESPONSES: Readonly<Record<ChatError, { status: number; message: string }>> = {
  unauthenticated: { status: 401, message: "Please sign in to keep talking." },
  invalid_body: { status: 400, message: "That message could not be sent." },
  rate_limited: {
    status: 429,
    message: "You are sending messages very quickly. Give it a moment.",
  },
  learner_unavailable: {
    status: 404,
    message: "We could not load your profile. Please refresh and try again.",
  },
  thread_unavailable: {
    status: 404,
    message: "That conversation could not be found. Start a new one from the chat page.",
  },
  generation_failed: {
    status: 503,
    message: "Your tutor is unavailable right now. Please try again shortly.",
  },
  // 402 is the status that says what it is: the request is fine, the plan
  // does not include it. No plan has a zero tutor quota today; the answer is
  // here so that a catalogue change is not also a new failure mode.
  plan_required: {
    status: 402,
    message: "Talking with the tutor needs a paid plan.",
  },
  quota_exhausted: {
    status: 429,
    message: "You've used today's tutor turns.",
  },
  // Never "budget": that is the operator's word for it. The learner has an
  // allowance, and the prompt says when it renews.
  budget_exhausted: {
    status: 429,
    message: "You've used your AI allowance for now.",
  },
};

export const chatErrorResponse = (error: ChatError) => RESPONSES[error];

export interface ChatDeps extends GraphDeps {
  readonly logger?: Logger;
}

export interface ChatOutcome {
  readonly chunks: AsyncIterable<string>;
  /** Resolves once the turn is evaluated and accounted for. */
  readonly completed: Promise<unknown>;
  /**
   * The level tally after this turn was counted, or null when it was not —
   * a triaged-out "Danke!", a failed evaluation, a failed write. Known only
   * once the after-stream work has run, which is why it travels as a stream
   * trailer rather than a header. Never rejects.
   */
  readonly tally: Promise<ChatTrailer["tally"] | null>;
  /**
   * Where the learner stands as this reply is written — after any move this
   * turn made. Known before the first byte streams, which is what lets the
   * route say it in a header and the page keep its "you are here" honest
   * without a reload.
   */
  readonly position: {
    readonly miniLevel: number;
    readonly theme: string;
  } | null;
}

export type ChatResult =
  | { readonly ok: true; readonly outcome: ChatOutcome }
  | {
      readonly ok: false;
      readonly error: ChatError;
      readonly detail?: string;
      /** When a spent allowance or quota reopens, on a plan refusal only; null when nothing does. */
      readonly resetAt?: Date | null;
      /** A short wait worth saying, on an outage that is expected to pass. */
      readonly retryAfterSeconds?: number;
    };

/** How long to suggest waiting when the quota store could not count: a blip, not a day. */
export const QUOTA_OUTAGE_RETRY_SECONDS = 30;

/**
 * Runs one chat turn.
 *
 * `body` is unknown on purpose: it arrives from the network, and the schema is
 * the only thing that decides what it is.
 */
export async function handleChatTurn(
  body: unknown,
  identity: {
    readonly learnerId: string;
    readonly userIdHash: string;
    readonly requestId: string;
    /** Resolved by the route from entitlement rows — required, so no route forgets it. */
    readonly plan: PlanCode;
  },
  deps: ChatDeps,
  /**
   * The day's tutor turn, counted by the route for the plan it resolved.
   * Asked by the turn itself once the body parsed, the learner loaded and
   * the thread proved theirs (lib/graph/turn.ts); absent, nothing is counted.
   */
  admit?: TurnAdmission,
): Promise<ChatResult> {
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_body",
      detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
    };
  }

  const input: TurnInput = {
    learnerId: identity.learnerId,
    threadId: parsed.data.threadId,
    message: parsed.data.message,
    history: parsed.data.history,
    requestId: identity.requestId,
    userIdHash: identity.userIdHash,
    plan: identity.plan,
  };

  const turn = await runTurn(input, deps, admit);

  // The plan's answer is not a fault, and is not logged as one: the route
  // says it to the learner, and the quota's own store has the count.
  if (!turn.ok && turn.reason === "not_admitted" && turn.refusal) {
    // A store that could not count is an outage like any other; only the
    // plan's own two answers are upgrade prompts.
    if (turn.refusal.refusal === "unavailable") {
      return { ok: false, error: "generation_failed", retryAfterSeconds: QUOTA_OUTAGE_RETRY_SECONDS };
    }
    return { ok: false, error: turn.refusal.refusal, resetAt: turn.refusal.resetAt };
  }

  if (!turn.ok) {
    (deps.logger ?? nullLogger).warn("chat.turn_refused", {
      requestId: identity.requestId,
      userIdHash: identity.userIdHash,
      reason: turn.reason,
      // With the detail, not just the node. Which node failed narrows it to a
      // third of the turn; why it failed is the thing anybody reading this
      // line actually came for, and it was being dropped on the floor.
      nodes: turn.state.notes
        .map((note) =>
          note.detail
            ? `${note.node}:${note.outcome}(${note.detail})`
            : `${note.node}:${note.outcome}`,
        )
        .join(","),
    });

    if (turn.reason === "budget_exhausted" && turn.budgetScope) {
      const now = deps.now?.() ?? new Date();
      return {
        ok: false,
        error: "budget_exhausted",
        resetAt: allowanceRenewsAt(turn.budgetScope, now),
      };
    }

    return { ok: false, error: turn.reason === "not_admitted" ? "generation_failed" : turn.reason };
  }

  const learner = turn.turn.state.learner;

  return {
    ok: true,
    outcome: {
      chunks: turn.turn.chunks,
      completed: turn.turn.completed,
      // Derived rather than exposed: the stream needs three numbers, not the
      // whole turn state. A turn that failed to complete simply has no tally.
      tally: turn.turn.completed.then(
        (state) => state.performance ?? null,
        () => null,
      ),
      // No position for a scene: the page shows the scene, not a level, and
      // a header naming one would only invite the client to draw a move.
      position:
        learner && !turn.turn.state.thread?.scene
          ? { miniLevel: learner.state.miniLevel, theme: learner.miniLevel.theme }
          : null,
    },
  };
}

/**
 * Turns the reply into bytes.
 *
 * Plain UTF-8 text rather than server-sent events: the client renders German
 * prose as it arrives and has one other thing to hear, not many — so the
 * framing is one delimiter and one trailer (chat-trailer.ts) rather than an
 * event format. The reply's own text is scrubbed of the delimiter first, so
 * nothing a model emits can open the trailer early.
 *
 * The after-stream work is awaited inside the stream's own lifetime, so a
 * serverless runtime does not tear the process down between the last chunk and
 * the message being saved — and it is also what makes the trailer possible:
 * by the time the stream may close, the tally has been written.
 */
export function toReadableStream(outcome: ChatOutcome): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of outcome.chunks) {
          controller.enqueue(
            encoder.encode(chunk.replaceAll(TRAILER_DELIMITER, "")),
          );
        }
      } catch {
        // The learner keeps whatever arrived. Closing quietly beats emitting
        // an error message into the middle of the tutor's German.
      } finally {
        try {
          await outcome.completed;
          const tally = await outcome.tally;
          if (tally) controller.enqueue(encoder.encode(encodeChatTrailer({ tally })));
        } catch {
          // Persistence and accounting log their own failures; a learner who
          // has already read the reply should not see this.
        }
        controller.close();
      }
    },
  });
}
