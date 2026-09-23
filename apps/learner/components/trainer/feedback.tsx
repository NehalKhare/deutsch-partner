"use client";

import { useState } from "react";

import { buttonQuiet, field, focusRing } from "@dp/ui/styles";
import {
  FEEDBACK_REASONS,
  MAX_FEEDBACK_NOTE_LENGTH,
  type CoachingDials,
  type FeedbackReason,
  type FeedbackVerdict,
} from "@dp/domain/trainer-coaching";
import { FEEDBACK_REASON_LABELS } from "@dp/domain/trainer-coaching";
import { cn } from "@dp/ui/utils";

/**
 * The vote under a trainer reply.
 *
 * Two buttons and, behind the second, the reasons. The reasons are the whole
 * point: a bare thumbs-down teaches the product nothing it can act on, while
 * "too long" moves a dial. So a helpful vote sends at once and an unhelpful
 * one opens a short closed list and an optional line in the learner's words,
 * and the confirmation says what changed — a learner who can see their
 * feedback land is a learner who gives more of it.
 *
 * What travels is the verdict, the reasons, the note and the reply's tool
 * receipt. The reply's text stays in the browser, like the rest of the
 * transcript.
 */

/** What a changed dial says in the confirmation. */
const CHANGE_LABELS: Readonly<Record<keyof CoachingDials, string>> = {
  explanationDepth: "explanations",
  challenge: "exercise difficulty",
  sessionLength: "session length",
  focus: "the practice mix",
  news: "the news item",
};

interface FeedbackResponse {
  readonly coaching?: CoachingDials;
  readonly changed?: ReadonlyArray<{ dial: keyof CoachingDials }>;
  readonly noteDropped?: boolean;
  readonly message?: string;
}

export interface ReplyFeedbackProps {
  /** The reply's tool receipt, sent along as context. */
  readonly tools: readonly string[];
  /** Told what the dials are now, so the session can show them. */
  readonly onCoaching?: (dials: CoachingDials) => void;
  readonly endpoint?: string;
}

type Stage =
  | { readonly kind: "idle" }
  | { readonly kind: "reasons" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent"; readonly said: string }
  | { readonly kind: "failed"; readonly said: string };

export function ReplyFeedback({
  tools,
  onCoaching,
  endpoint = "/api/trainer/feedback",
}: ReplyFeedbackProps) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [reasons, setReasons] = useState<readonly FeedbackReason[]>([]);
  const [note, setNote] = useState("");

  async function send(verdict: FeedbackVerdict) {
    setStage({ kind: "sending" });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verdict,
          reasons: verdict === "unhelpful" ? reasons : [],
          note: verdict === "unhelpful" ? note.trim() : "",
          tools: tools.slice(0, 8),
        }),
      });
      const body = (await response.json().catch(() => null)) as FeedbackResponse | null;
      if (!response.ok) {
        throw new Error(body?.message ?? "Your feedback could not be sent.");
      }

      if (body?.coaching && onCoaching) onCoaching(body.coaching);

      const moved = (body?.changed ?? []).map((change) => CHANGE_LABELS[change.dial]);
      const said =
        moved.length > 0
          ? `Thanks — your trainer will adjust ${listed(moved)}.`
          : verdict === "helpful"
            ? "Thanks — noted."
            : "Thanks — your trainer will keep this in mind.";
      setStage({
        kind: "sent",
        said: body?.noteDropped
          ? `${said} Your note was not kept: it looked like it held a password or key.`
          : said,
      });
    } catch (failure) {
      setStage({
        kind: "failed",
        said: failure instanceof Error ? failure.message : "Your feedback could not be sent.",
      });
    }
  }

  const toggle = (reason: FeedbackReason) =>
    setReasons((current) =>
      current.includes(reason)
        ? current.filter((candidate) => candidate !== reason)
        : [...current, reason],
    );

  if (stage.kind === "sent" || stage.kind === "failed") {
    return (
      <p
        role="status"
        data-role="feedback-outcome"
        className={cn("px-1 text-xs", stage.kind === "failed" ? "text-ember" : "text-copy/60")}
      >
        {stage.said}
      </p>
    );
  }

  return (
    <div data-role="feedback" className="flex flex-col gap-2 px-1">
      <div className="flex items-center gap-1.5 text-xs text-copy/45">
        <span>Was this helpful?</span>
        <button
          type="button"
          aria-label="Helpful"
          aria-pressed={false}
          disabled={stage.kind === "sending"}
          onClick={() => void send("helpful")}
          className={cn(
            "rounded-full px-2 py-0.5 transition-colors hover:text-sprout",
            focusRing,
          )}
        >
          Yes
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          aria-pressed={stage.kind === "reasons"}
          disabled={stage.kind === "sending"}
          onClick={() =>
            setStage((current) =>
              current.kind === "reasons" ? { kind: "idle" } : { kind: "reasons" },
            )
          }
          className={cn(
            "rounded-full px-2 py-0.5 transition-colors hover:text-ember",
            stage.kind === "reasons" && "text-ember",
            focusRing,
          )}
        >
          No
        </button>
      </div>

      {stage.kind === "reasons" || stage.kind === "sending" ? (
        <form
          data-role="feedback-reasons"
          className="flex flex-col gap-2 rounded-xl border border-edge/60 bg-panel/60 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send("unhelpful");
          }}
        >
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="mb-1.5 text-xs text-copy/60">What went wrong?</legend>
            {FEEDBACK_REASONS.map((reason) => {
              const on = reasons.includes(reason);
              return (
                <button
                  key={reason}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(reason)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    on
                      ? "border-brand bg-brand/15 text-brand"
                      : "border-edge/70 text-copy/70 hover:text-copy",
                    focusRing,
                  )}
                >
                  {FEEDBACK_REASON_LABELS[reason]}
                </button>
              );
            })}
          </fieldset>
          <input
            aria-label="Anything else your trainer should know?"
            placeholder="Anything else? (optional)"
            value={note}
            maxLength={MAX_FEEDBACK_NOTE_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            className={cn(field, "text-sm")}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setStage({ kind: "idle" })}
              className={cn(buttonQuiet, "px-3 py-1.5 text-xs")}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={stage.kind === "sending"}
              className={cn(
                "rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-on-accent",
                "disabled:opacity-60",
                focusRing,
              )}
            >
              {stage.kind === "sending" ? "Sending…" : "Send feedback"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** "a, b and c" — the confirmation reads as a sentence, not a list. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
