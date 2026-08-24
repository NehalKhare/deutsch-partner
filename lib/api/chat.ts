import { z } from "zod";

import {
  HISTORY_WINDOW,
  MAX_MESSAGE_LENGTH,
  transcriptMessageSchema,
} from "@/domain/conversation";
import { nonEmptyTextSchema, uuidSchema } from "@/domain/primitives";
import type { GraphDeps } from "@/lib/graph/nodes";
import { runTurn } from "@/lib/graph/turn";
import type { TurnInput } from "@/lib/graph/state";
import { nullLogger, type Logger } from "@/lib/observability/logger";

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
  | { readonly ok: false; readonly error: ChatError; readonly detail?: string };

/**
 * Runs one chat turn.
 *
 * `body` is unknown on purpose: it arrives from the network, and the schema is
 * the only thing that decides what it is.
 */
export async function handleChatTurn(
  body: unknown,
  identity: { readonly learnerId: string; readonly userIdHash: string; readonly requestId: string },
  deps: ChatDeps,
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
  };

  const turn = await runTurn(input, deps);

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

    return { ok: false, error: turn.reason };
  }

  const learner = turn.turn.state.learner;

  return {
    ok: true,
    outcome: {
      chunks: turn.turn.chunks,
      completed: turn.turn.completed,
      position: learner
        ? { miniLevel: learner.state.miniLevel, theme: learner.miniLevel.theme }
        : null,
    },
  };
}

/**
 * Turns the reply into bytes.
 *
 * Plain UTF-8 text rather than server-sent events: the client renders German
 * prose as it arrives and has no other event types to distinguish. Adding a
 * framing format nobody needs would be one more thing to get wrong.
 *
 * The after-stream work is awaited inside the stream's own lifetime, so a
 * serverless runtime does not tear the process down between the last chunk and
 * the message being saved.
 */
export function toReadableStream(outcome: ChatOutcome): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of outcome.chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch {
        // The learner keeps whatever arrived. Closing quietly beats emitting
        // an error message into the middle of the tutor's German.
      } finally {
        try {
          await outcome.completed;
        } catch {
          // Persistence and accounting log their own failures; a learner who
          // has already read the reply should not see this.
        }
        controller.close();
      }
    },
  });
}
