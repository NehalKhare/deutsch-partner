"use client";

import { useRef, useState } from "react";

import { buttonPrimary, field } from "@/components/ui/styles";
import { HISTORY_WINDOW } from "@/domain/conversation";
import { cn } from "@/lib/utils";

/** Shown when a refusal arrives with nothing a learner could act on. */
const FALLBACK_ERROR = "Something went wrong. Please try again.";

interface TrainerStep {
  readonly tool: string;
  readonly summary: string;
}

interface TrainerSource {
  readonly documentId: number;
  readonly contentType: string;
  readonly score: number;
}

interface SessionEntry {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  /** What the trainer did to answer: tool calls, shown as receipts. */
  readonly steps?: readonly TrainerStep[];
  readonly sources?: readonly TrainerSource[];
}

/** How each tool's work is described to the learner. */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  get_review_session: "Looked up what is due for review",
  get_progress: "Checked your progress",
  get_grammar_pattern: "Opened the grammar shelf",
  search_knowledge: "Searched the learning material",
  record_review_outcome: "Recorded how that went",
  fetch_simple_german_news: "Fetched today's simple-German news",
};

const toolLabel = (tool: string) =>
  TOOL_LABELS[tool] ?? `Asked a connected tool (${tool})`;

/**
 * The Trainer's session: a chat with receipts.
 *
 * A simpler sibling of the conversation component — no voice, no streaming.
 * One request is a whole agent loop, so the wait is honest (a visible working
 * indicator rather than a fake stream) and the answer arrives with the list
 * of tools it used and the sources it read, because an agent that shows its
 * work is the difference between an answer and an assertion.
 *
 * The transcript lives here and only here, like the chat's: each turn carries
 * its own recent history up, and nothing is stored. What survives is what
 * the tools wrote — review outcomes into vocabulary progress.
 */
export function TrainerSession() {
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  async function send(message: string) {
    const id = `local-${nextId.current++}`;
    // Snapshotted before the optimistic append; the message travels apart
    // from the history, and steps/sources are display-only bookkeeping.
    const history = entries
      .slice(-HISTORY_WINDOW)
      .map(({ role, content }) => ({ role, content }));

    setError(null);
    setPending(true);
    setEntries((previous) => [...previous, { id, role: "user", content: message }]);

    try {
      const response = await fetch("/api/trainer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });

      const body = (await response.json().catch(() => null)) as
        | {
            reply?: string;
            steps?: TrainerStep[];
            sources?: TrainerSource[];
            message?: string;
          }
        | null;

      if (!response.ok || typeof body?.reply !== "string") {
        throw new Error(body?.message ?? FALLBACK_ERROR);
      }

      setEntries((previous) => [
        ...previous,
        {
          id: `reply-${nextId.current++}`,
          role: "assistant",
          content: body.reply!,
          steps: body.steps ?? [],
          sources: body.sources ?? [],
        },
      ]);
    } catch (failure) {
      // The turn did not happen; the words go back where they can be resent.
      setEntries((previous) => previous.filter((entry) => entry.id !== id));
      setDraft((current) => (current.length === 0 ? message : current));
      setError(failure instanceof Error ? failure.message : FALLBACK_ERROR);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {entries.length === 0 ? (
          <div className="m-auto flex max-w-sm flex-col gap-2 text-center">
            <p className="text-chalk/45">
              Your trainer runs the drills the tutor does not: say{" "}
              <span lang="de" className="text-chalk/70">
                „Lass uns üben!“
              </span>{" "}
              to review your due words, or ask anything about your progress.
            </p>
            <p className="text-xs text-chalk/55">
              The trainer shows which tools it used to answer.
            </p>
          </div>
        ) : null}

        <ol className="mt-auto flex flex-col gap-3" aria-live="polite">
          {entries.map((entry) =>
            entry.role === "user" ? (
              <li
                key={entry.id}
                data-role="user"
                className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-apricot px-4 py-2.5 leading-relaxed text-ink"
              >
                {entry.content}
              </li>
            ) : (
              <li
                key={entry.id}
                data-role="assistant"
                className="flex max-w-[85%] flex-col gap-2 self-start"
              >
                <span
                  lang="de"
                  className="rounded-2xl rounded-bl-md border border-haze/70 bg-dusk px-4 py-2.5 leading-relaxed text-chalk"
                >
                  {entry.content}
                </span>

                {entry.steps && entry.steps.length > 0 ? (
                  <ul
                    data-role="steps"
                    aria-label="What the trainer did"
                    className="flex flex-col gap-1 px-1"
                  >
                    {entry.steps.map((step, index) => (
                      <li
                        key={`${entry.id}-step-${index}`}
                        className="flex items-baseline gap-2 text-xs text-chalk/55"
                      >
                        <span aria-hidden className="text-apricot/70">
                          ⚙
                        </span>
                        <span>
                          <span className="text-chalk/75">{toolLabel(step.tool)}</span>
                          {step.summary ? (
                            <span className="text-chalk/40"> — {step.summary}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {entry.sources && entry.sources.length > 0 ? (
                  <p data-role="sources" className="px-1 text-xs text-chalk/45">
                    Sources:{" "}
                    {entry.sources
                      .map((source) => `${source.contentType} #${source.documentId}`)
                      .join(", ")}
                  </p>
                ) : null}
              </li>
            ),
          )}
        </ol>
      </div>

      {/* One request is a whole agent loop, so the wait deserves an honest
          working indicator rather than a frozen page. */}
      {pending ? (
        <p role="status" className="flex items-center gap-2 px-1 text-sm text-chalk/55">
          <span
            aria-hidden
            className="size-2 animate-pulse rounded-full bg-apricot"
          />
          Your trainer is working — checking tools and thinking…
        </p>
      ) : (
        <p role="status" className="sr-only" />
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ember/40 bg-ember/10 px-4 py-2.5 text-sm text-ember"
        >
          {error}
        </p>
      ) : null}

      <form
        className="sticky bottom-0 flex items-center gap-3 border-t border-haze/60 bg-ink/95 py-4 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (message.length === 0 || pending) return;

          setDraft("");
          void send(message);
        }}
      >
        <input
          ref={inputRef}
          name="message"
          aria-label="Your message to the trainer"
          placeholder="Lass uns üben…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          lang="de"
          className={cn(field, "flex-1")}
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className={cn(buttonPrimary, "px-5 py-2.5")}
        >
          {pending ? "Working…" : "Send"}
        </button>
      </form>
    </div>
  );
}
