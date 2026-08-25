"use client";

import { useEffect, useRef, useState } from "react";

import { useReadAloud } from "@/components/voice/read-aloud";
import { SpeakerIcon } from "@/components/voice/speaker-icon";
import type { SpeechPlayback, SpeechVoice } from "@/components/voice/speech";
import { RichText } from "@/components/ui/rich-text";
import { buttonPrimary, field, focusRing } from "@/components/ui/styles";
import type { CEFRLevel } from "@/domain/cefr";
import { HISTORY_WINDOW } from "@/domain/conversation";
import { MAX_COVERED_SUBJECTS } from "@/domain/trainer-session";
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

/** One line of the session's agenda, as the server planned it. */
interface AgendaItem {
  readonly kind: string;
  readonly subject: string;
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

/** What each kind of practice asks of the learner, in a word or three. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  recognise: "meaning",
  recall: "recall",
  use_in_sentence: "use in a sentence",
  correct_the_mistake: "fix the mistake",
  read_the_news: "read today's news",
};

/** The same control the chat header carries, in the trainer's agenda panel. */
function ReadAloudToggle({
  on,
  onToggle,
}: {
  readonly on: boolean;
  readonly onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      aria-pressed={on}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs",
        "uppercase tracking-wider transition-colors",
        on ? "text-apricot" : "text-chalk/70 hover:text-chalk",
        focusRing,
      )}
    >
      <SpeakerIcon speaking={on} />
      Read replies aloud
    </button>
  );
}

/**
 * The Trainer's session: a chat with receipts.
 *
 * A simpler sibling of the conversation component — no voice, no streaming.
 * One request is a whole agent loop, so the wait is honest (a visible working
 * indicator rather than a fake stream) and the answer arrives with the list
 * of tools it used and the sources it read, because an agent that shows its
 * work is the difference between an answer and an assertion.
 *
 * The transcript lives here and only here, like the chat's, and so does the
 * session: the agenda the trainer planned and the subjects it has closed. Each
 * turn carries both up, which is what stops the same word being asked twice —
 * and what keeps the plan on screen after the message announcing it has
 * scrolled away. Nothing is stored; what survives is what the tools wrote,
 * review outcomes into vocabulary progress.
 */
export function TrainerSession({
  cefr = "A1",
  voiceGender = "male",
  outputPreference = "text",
  playback,
  voice,
}: {
  /** Decides how fast the trainer speaks. A1 is read more slowly than B1. */
  readonly cefr?: CEFRLevel;
  /** The learner's chosen voice, from settings. Steers both speech paths. */
  readonly voiceGender?: "male" | "female";
  /**
   * How the learner said replies should arrive. "voice" starts the session
   * reading aloud; the toggle still overrides it for this sitting.
   */
  readonly outputPreference?: "text" | "voice";
  readonly playback?: SpeechPlayback;
  /** The browser's own voice, used when the server has none configured. */
  readonly voice?: SpeechVoice;
} = {}) {
  // The same read-aloud the chat uses, and the same fallback chain: a drill is
  // no less worth hearing than a conversation, and hearing "der Bahnhof" said
  // is most of what learning to say it is.
  const { canSpeak, speakingId, notice: voiceNotice, speak } = useReadAloud({
    cefr,
    voiceGender,
    playback,
    voice,
  });
  const [readAloud, setReadAloud] = useState(outputPreference === "voice");

  const [entries, setEntries] = useState<SessionEntry[]>([]);
  // The session's plan and its progress, held here for the same reason the
  // transcript is: the endpoint is stateless, so each turn carries them up and
  // the server answers with what is still to do.
  const [agenda, setAgenda] = useState<readonly AgendaItem[] | null>(null);
  const [covered, setCovered] = useState<readonly string[]>([]);
  const [complete, setComplete] = useState(false);
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
        body: JSON.stringify({
          message,
          history,
          covered: covered.slice(-MAX_COVERED_SUBJECTS),
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | {
            reply?: string;
            steps?: TrainerStep[];
            sources?: TrainerSource[];
            agenda?: AgendaItem[] | null;
            covered?: string[];
            complete?: boolean;
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
      // A null agenda means this turn was about something else — a grammar
      // question, the news — and the plan on screen still stands. An empty
      // one means the session is finished, which is a different thing to say.
      if (body.agenda !== null && body.agenda !== undefined) setAgenda(body.agenda);
      if (body.covered) setCovered(body.covered);
      // The agenda is finished, and the reply just delivered the recall list.
      // Nothing is left to ask, so the session closes rather than idling with
      // an open box that invites a question the trainer is told not to answer.
      if (body.complete) setComplete(true);
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

  // Reads the newest reply when the learner has asked for that. Keyed on the
  // entry id so a re-render cannot make it read the same line twice.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    // canSpeak too: the preference can arrive switched on for a device with
    // no voice, and a notice per reply is worse than silence.
    if (!readAloud || !canSpeak) return;

    const newest = entries[entries.length - 1];
    if (!newest || newest.role !== "assistant") return;
    if (lastSpoken.current === newest.id) return;

    lastSpoken.current = newest.id;
    void speak(newest);
    // speak is redefined every render; the id guard above is what makes this
    // run once, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, readAloud]);

  /** A fresh sitting: the plan starts again from whatever is still due. */
  function startNewSession() {
    setEntries([]);
    setAgenda(null);
    setCovered([]);
    setComplete(false);
    setError(null);
    setDraft("");
  }

  // Done first, then what is left, which is the order the session runs in.
  // Covered subjects are the ones this browser has been told are closed, so
  // the list stays whole even after the trainer's opening message scrolls away.
  const plan = agenda
    ? [
        ...covered.map((subject) => ({ subject, kind: null, done: true })),
        ...agenda.map((item) => ({ ...item, done: false })),
      ]
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* Above the agenda rather than inside it: a learner who wants to be
          read to wants that from the first reply, and the agenda does not
          exist until the trainer has planned one. */}
      {canSpeak ? (
        <div className="flex shrink-0 justify-end">
          <ReadAloudToggle on={readAloud} onToggle={setReadAloud} />
        </div>
      ) : null}

      {plan.length > 0 ? (
        <section
          data-role="agenda"
          aria-label="What this session covers"
          className="shrink-0 rounded-2xl border border-haze/70 bg-dusk/70 px-4 py-3"
        >
          <p className="text-xs uppercase tracking-[0.14em] text-chalk/45">
            This session
            {agenda?.length === 0 ? " — done" : null}
          </p>
          <ol className="mt-2 flex flex-col gap-1">
            {plan.map((item) => (
              <li
                key={`${item.subject}-${String(item.done)}`}
                data-done={String(item.done)}
                className="flex items-baseline gap-2 text-sm"
              >
                <span aria-hidden className="text-apricot/70">
                  {item.done ? "✓" : "•"}
                </span>
                <span
                  lang="de"
                  className={item.done ? "text-chalk/40 line-through" : "text-chalk/80"}
                >
                  {item.subject}
                </span>
                {item.kind ? (
                  <span className="text-xs text-chalk/40">
                    {KIND_LABELS[item.kind] ?? item.kind}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
                <div className="flex items-start gap-1.5">
                  <span
                    lang="de"
                    className="rounded-2xl rounded-bl-md border border-haze/70 bg-dusk px-4 py-2.5 leading-relaxed text-chalk"
                  >
                    <RichText content={entry.content} />
                  </span>
                  {canSpeak ? (
                    <button
                      type="button"
                      onClick={() => void speak(entry)}
                      aria-label={
                        speakingId === entry.id
                          ? "Stop reading this reply"
                          : "Read this reply aloud"
                      }
                      aria-pressed={speakingId === entry.id}
                      className={cn(
                        "mt-1.5 shrink-0 rounded-full p-1.5 text-chalk/50 transition-colors hover:text-apricot",
                        speakingId === entry.id && "text-apricot",
                        focusRing,
                      )}
                    >
                      <SpeakerIcon speaking={speakingId === entry.id} />
                    </button>
                  ) : null}
                </div>

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

      {/* Voice is an addition to the session, not the session. Its failures
          are said quietly, and never as the red banner that means "your turn
          did not happen". */}
      {voiceNotice ? (
        <p role="status" className="px-1 text-xs text-chalk/55">
          {voiceNotice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ember/40 bg-ember/10 px-4 py-2.5 text-sm text-ember"
        >
          {error}
        </p>
      ) : null}

      {complete ? (
        <section
          data-role="session-end"
          className="sticky bottom-0 flex flex-col gap-3 border-t border-haze/60 bg-ink/95 py-4 backdrop-blur"
        >
          <p className="text-sm text-chalk/70">
            Session complete — that is everything that was due. Your trainer&apos;s
            last message is what to take away.
          </p>
          <button
            type="button"
            onClick={startNewSession}
            className={cn(buttonPrimary, "self-start px-5 py-2.5")}
          >
            Start a new session
          </button>
        </section>
      ) : (
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
      )}
    </div>
  );
}
