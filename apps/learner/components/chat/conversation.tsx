"use client";

import { useEffect, useRef, useState } from "react";

import { Companion } from "@/components/companion/companion";
import { MasteryProgress } from "@/components/chat/mastery-progress";
import { RichText } from "@dp/ui/rich-text";
import {
  createBrowserCapture,
  type SpeechCapture,
  type SpeechPlayback,
  type SpeechVoice,
} from "@/components/voice/speech";
import { useReadAloud } from "@/components/voice/read-aloud";
import { SpeakerIcon } from "@/components/voice/speaker-icon";
import { splitChatStream } from "@/lib/api/chat-trailer";
import { masteryStripStore, useDevicePreference } from "@/lib/settings/device";
import type { CEFRLevel } from "@dp/domain/cefr";
import { HISTORY_WINDOW } from "@dp/domain/conversation";
import { buttonPrimary, buttonQuiet, field, focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import { companionActivityFor, companionStateFor } from "@dp/domain/companion";
import { TUTOR } from "@dp/domain/tutor";
import {
  hasMastered,
  thresholdRatio,
  turnQuality,
  type TurnQuality,
} from "@dp/learning/mastery";

/** Shown when a refusal arrives with nothing a learner could act on. */
const FALLBACK_ERROR = "Something went wrong. Please try again.";

// The strip's visibility and the read-aloud engine are device preferences —
// see lib/settings/device.ts for why they live in localStorage rather than
// the profile.

/** The tally for the level being stood on, tagged with which level that is. */
interface PositionedTally {
  readonly miniLevel: number;
  readonly turns: number;
  readonly strongTurns: number;
}

/*
 * Drawn here rather than pulled from an icon set. Two shapes at one size is
 * not worth a dependency, and both are decorative: the button around each one
 * carries the name, so a screen reader never meets the drawing.
 */

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * A line in the conversation's flow that nobody spoke: the moment the level
 * moved. It is rendered as a divider, never read aloud, and never sent back
 * to the server as history — the transcript schema knows only the two
 * speaking roles, which is exactly right.
 */
interface Milestone {
  readonly id: string;
  readonly role: "milestone";
  readonly miniLevel: number;
  readonly theme: string | null;
}

type FlowEntry = ChatMessage | Milestone;

/** The lines that were actually said, which is all a transcript may carry. */
function isSpeech(entry: FlowEntry): entry is ChatMessage {
  return entry.role !== "milestone";
}

/**
 * The conversation, streamed.
 *
 * The learner's own message appears immediately and the tutor's arrives a word
 * at a time, because waiting in silence for a whole German paragraph feels
 * broken even when it is fast.
 *
 * That is why none of this runs inside a transition. React 19 holds every
 * update made inside an async `startTransition` until the action settles, so
 * a streamed reply wrapped in one does not stream: the learner's own message,
 * every chunk of the answer and the companion's whole performance all land at
 * once, at the end. `sending` is therefore plain state, and each chunk is an
 * urgent update.
 *
 * Nothing here decides anything. It sends a thread id, a message and the
 * recent transcript, renders the bytes that come back, and shows a plain
 * sentence if the server refuses. Every rule about who may post and what it
 * costs lives on the server, where a learner cannot edit it.
 *
 * The transcript lives here and only here. Nothing a learner says in a
 * conversation is written to storage of any kind — not a database row, not
 * localStorage — so each turn carries its own recent history up to the
 * server, and closing the tab is genuinely the end of the conversation. What
 * survives is the level tally the server keeps about how the practice went.
 *
 * The companion is driven by what is actually happening rather than by a
 * timer: listening while the learner types or speaks, speaking while the
 * reply is arriving — or, once there is a voice, while it is being read out.
 *
 * Recording and playback arrive as ports rather than as MediaRecorder and
 * Audio, because jsdom has neither and a component that reaches for them
 * directly cannot be tested at all.
 *
 * Reading a reply aloud tries the speech model first and the browser's own
 * voice second. The model sounds like a person; the browser needs no key and
 * costs nothing, which makes it the difference between a tutor that can be
 * heard and one that could have been.
 */
export function Conversation({
  threadId,
  title,
  initialMessages = [],
  miniLevel,
  theme,
  cefr = "A1",
  voiceGender = "male",
  outputPreference = "text",
  masteryThreshold = 80,
  initialTally,
  capture,
  playback,
  voice,
}: {
  threadId: string;
  /** The thread's name, shown beside the companion in the header. */
  title?: string;
  /** A seed for tests and demos. Production threads always start empty. */
  initialMessages?: readonly ChatMessage[];
  /** How far the learner has come, which is how large the companion is. */
  miniLevel: number;
  /** What the current mini-level is called, so "next" is not a leap in the dark. */
  theme?: string;
  /**
   * The stored tally for the current level, so the mastery strip starts where
   * the learner actually is rather than at zero. Absent when the level has no
   * turns yet, or when the read failed — either way the strip starts empty.
   */
  initialTally?: { readonly turns: number; readonly strongTurns: number };
  /** The learner's chosen voice, from settings. Steers both speech paths. */
  voiceGender?: "male" | "female";
  /**
   * How the learner said replies should arrive, from their profile. "voice"
   * starts the session reading aloud, because a learner who asked to be read
   * to should not have to ask again on every page — and the toggle is still
   * there, so this is a starting position rather than a lock.
   */
  outputPreference?: "text" | "voice";
  /**
   * The learner's pass mark from settings: the share of evaluated turns that
   * must be error-free before the level counts as cleared. The server holds
   * the same value and applies it to the move's bookkeeping; this one only
   * draws the strip and decides when the offer shows.
   */
  masteryThreshold?: number;
  /** Decides how fast the tutor speaks. A1 is read more slowly than B1. */
  cefr?: CEFRLevel;
  capture?: SpeechCapture;
  playback?: SpeechPlayback;
  /** The browser's own voice, used when the server has none configured. */
  voice?: SpeechVoice;
}) {
  const [messages, setMessages] = useState<FlowEntry[]>([...initialMessages]);
  // Where the learner stands right now. A turn that moves them — by asking,
  // by the button, or by confirming an earned move — says so in the response
  // headers, and this is what keeps the label and companion honest without a
  // reload.
  const [position, setPosition] = useState({ miniLevel, theme: theme ?? null });
  // The heading follows the conversation: threads are titled by the theme
  // they were opened for, so when the level moves, the room is renamed to
  // what is being practised now.
  const [heading, setHeading] = useState(title ?? null);

  // The level tally the mastery strip draws. Mirrored into a ref because the
  // trailer that updates it arrives inside dispatch, whose closure would
  // otherwise compare against the tally from the render it was created in.
  const [tally, setTally] = useState<PositionedTally>({
    miniLevel,
    turns: initialTally?.turns ?? 0,
    strongTurns: initialTally?.strongTurns ?? 0,
  });
  const tallyRef = useRef(tally);
  function updateTally(next: PositionedTally) {
    tallyRef.current = next;
    setTally(next);
  }
  // How the newest counted turn went. Cleared when the next turn starts, so
  // the verdict on the strip is always about the message just above it.
  const [lastTurn, setLastTurn] = useState<TurnQuality | null>(null);
  // The level whose "cleared" offer the learner waved away. Mastery moves
  // nobody by itself: the gate opening is announced, and the learner chooses
  // between moving on and staying. A new level makes the dismissal stale.
  const [offerDeclinedFor, setOfferDeclinedFor] = useState<number | null>(null);
  const showMastery = useDevicePreference(masteryStripStore) === "shown";
  function toggleMastery() {
    masteryStripStore.write(showMastery ? "hidden" : "shown");
  }
  // Reading a reply out is the same job here and in the trainer, so the
  // fallback chain lives in one hook rather than in two copies of it.
  const {
    canSpeak,
    speakingId,
    notice: voiceNotice,
    speak,
  } = useReadAloud({ cefr, voiceGender, playback, voice });

  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Counted rather than derived from the list's length, because a refused turn
  // takes its message back out again and a length-derived id would be reused.
  const nextId = useRef(0);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [readAloud, setReadAloud] = useState(outputPreference === "voice");
  // The microphone's own quiet line. Separate from the read-aloud notice
  // because they fail for unrelated reasons and each is cleared by trying
  // again at the thing that raised it.
  const [micNotice, setMicNotice] = useState<string | null>(null);

  // Constructed once, and lazily: reaching for MediaRecorder at module load
  // would break every environment that does not have one, including the
  // server render of this very component.
  const captureRef = useRef<SpeechCapture | null>(capture ?? null);
  captureRef.current ??= createBrowserCapture();
  const recorder = captureRef.current;

  const [canRecord, setCanRecord] = useState(false);
  // Asked after mount: on the server there is no navigator to ask, and a mic
  // button rendered on the server and withdrawn on the client is a flicker.
  useEffect(() => {
    setCanRecord(recorder.supported());
  }, [recorder]);

  // The microphone must not stay open because somebody navigated away.
  useEffect(() => {
    return () => {
      recorder.cancel();
    };
  }, [recorder]);

  /**
   * Sends the turn and streams the reply back.
   *
   * Throws on every failure — a refusal, an unreadable body, a dropped
   * connection — so there is one rollback path rather than one per way of
   * failing.
   */
  async function dispatch(
    message: string,
    history: readonly Pick<ChatMessage, "role" | "content">[],
  ) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, message, history }),
    });

    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      throw new Error(body?.message ?? FALLBACK_ERROR);
    }

    const movedTo = response.headers.get("x-mini-level");
    const movedTheme = response.headers.get("x-mini-level-theme");
    if (movedTo && Number.isFinite(Number(movedTo))) {
      const level = Number(movedTo);
      const levelTheme = movedTheme ? decodeURIComponent(movedTheme) : null;
      setPosition({ miniLevel: level, theme: levelTheme });
      if (level !== tallyRef.current.miniLevel) {
        // A move means a new level with no evidence yet. The strip starts
        // again; the tally the old level earned is the server's to keep.
        updateTally({ miniLevel: level, turns: 0, strongTurns: 0 });
        // And the move is part of the conversation's story: a milestone line
        // marks it in the flow, and the room is renamed to the new topic —
        // threads are titled by the theme they were opened for.
        setMessages((previous) => [
          ...previous,
          {
            id: `milestone-${nextId.current++}`,
            role: "milestone",
            miniLevel: level,
            theme: levelTheme,
          },
        ]);
        if (levelTheme) setHeading(levelTheme);
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      // Everything before the trailer delimiter is the tutor talking; the
      // trailer itself must never appear in the bubble, even half-arrived.
      setStreaming(splitChatStream(text).reply);
    }

    const { reply, trailer } = splitChatStream(text);
    setStreaming("");
    setMessages((previous) => [
      ...previous,
      { id: `reply-${nextId.current++}`, role: "assistant", content: reply },
    ]);

    // The tally after this turn, from the same write the mastery gate reads.
    // The verdict is only worth showing when it is about a single counted
    // turn at the level the strip is already watching.
    if (trailer) {
      const before =
        tallyRef.current.miniLevel === trailer.tally.miniLevel
          ? tallyRef.current
          : null;
      setLastTurn(turnQuality(before, trailer.tally));
      updateTally(trailer.tally);
    }
  }

  /**
   * Owns the optimistic message, the sending flag and the failure path.
   *
   * The learner's words go up straight away, and come back down if the turn
   * was refused. Leaving them there would be the worst of both: a bubble that
   * looks delivered, that the server never saved, that vanishes on the next
   * reload — and that appears twice if they retype it and try again.
   */
  async function send(
    message: string,
    options: { readonly restoreOnFailure?: boolean } = {},
  ) {
    const { restoreOnFailure = true } = options;
    const id = `local-${nextId.current++}`;

    // Snapshotted before the optimistic append: the history is what was said
    // before this message, which travels separately. Milestones are filtered
    // out first — they are lines nobody spoke, and the server's transcript
    // schema rightly refuses any role that is not a speaking one.
    const speech = messages.filter(isSpeech);
    let recent = speech.slice(-HISTORY_WINDOW);

    // A scenario seed is the scene itself — the roles, or the whole reading
    // passage. Everything the tutor knows about this exercise is in that one
    // message, so it is pinned: once the conversation outgrows the window,
    // the seed takes the oldest slot rather than falling out of it. A tutor
    // asking comprehension questions about a passage it can no longer see
    // grades the learner against its own invention.
    const seed = speech[0]?.id.startsWith("scenario:") ? speech[0] : null;
    if (seed && !recent.some((line) => line.id === seed.id)) {
      recent = [seed, ...recent.slice(-(HISTORY_WINDOW - 1))];
    }

    const history = recent.map(({ role, content }) => ({ role, content }));

    setError(null);
    // A verdict about the previous turn must not sit beside a new one.
    setLastTurn(null);
    setSending(true);
    setMessages((previous) => [
      ...previous,
      { id, role: "user", content: message },
    ]);

    try {
      await dispatch(message, history);
    } catch (failure) {
      setStreaming("");
      setMessages((previous) => previous.filter((entry) => entry.id !== id));
      // Put their sentence back where they can send it again — unless they
      // have already started typing something else into the box. Never for
      // the button's synthetic "Weiter bitte!": the move can outlive a failed
      // reply (it is written before generation), and a restored draft would
      // turn "retry my sentence" into "advance another level".
      if (restoreOnFailure) {
        setDraft((current) => (current.length === 0 ? message : current));
      }
      setError(failure instanceof Error ? failure.message : FALLBACK_ERROR);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  // Reads the newest reply when the learner has asked for that. Keyed on the
  // message id so a re-render cannot make it read the same line twice.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    // canSpeak, not just readAloud: the preference can arrive switched on for
    // a device with no voice at all, and reading nothing aloud while saying so
    // once per reply is worse than silence.
    if (!readAloud || !canSpeak || streaming.length > 0) return;

    const newest = messages[messages.length - 1];
    if (!newest || newest.role !== "assistant") return;
    if (lastSpoken.current === newest.id) return;

    lastSpoken.current = newest.id;
    void speak(newest);
    // speak is redefined every render; the id guard above is what makes this
    // run once, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, readAloud, streaming]);

  /** Records, transcribes, and puts the words in the box — never sends them. */
  async function toggleRecording() {
    if (recording) {
      setRecording(false);
      setTranscribing(true);
      try {
        const clip = await recorder.stop();
        const form = new FormData();
        form.set("audio", clip.audio);
        form.set("durationMs", String(clip.durationMs));

        const response = await fetch("/api/transcribe", { method: "POST", body: form });
        const body = (await response.json().catch(() => null)) as
          | { text?: string; message?: string }
          | null;

        if (!response.ok || !body?.text) {
          throw new Error(body?.message ?? "We could not make that out.");
        }

        // Into the box, not into the thread. A learner has to see what was
        // heard before it becomes something they said — a misheard word is
        // the entire thing they are here to notice.
        setDraft((current) =>
          current.length === 0 ? body.text! : `${current} ${body.text}`,
        );
        inputRef.current?.focus();
      } catch (failure) {
        setMicNotice(
          failure instanceof Error ? failure.message : "We could not make that out.",
        );
      } finally {
        setTranscribing(false);
      }
      return;
    }

    setMicNotice(null);
    try {
      await recorder.start();
      setRecording(true);
    } catch {
      // Overwhelmingly this is the learner declining the permission prompt.
      setMicNotice("We could not reach your microphone.");
    }
  }

  // What the companion is doing is decided in the domain, not here: this
  // component only knows which of the things is currently true. Reading a
  // reply aloud is the companion speaking as much as streaming text is, and
  // talking into the microphone is composing a message.
  const activity = companionActivityFor({
    replying: streaming.length > 0 || speakingId !== null,
    sending: sending || transcribing,
    composing: draft.trim().length > 0 || recording,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* The tutor sits top left, where a face belongs in a conversation. The
          blob, the title and the position label are one unit: what is looking
          at you, what this room is called, and where you are standing. All of
          it is live — a move mid-conversation updates the label and grows the
          blob without a reload. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-edge/60 pb-4">
        <Companion
          state={companionStateFor({ miniLevel: position.miniLevel, activity })}
          decorative
          className="[--companion-size:4.25rem]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {heading ? (
            <h1
              lang="de"
              className="truncate font-display text-xl font-semibold tracking-tight"
            >
              {heading}
            </h1>
          ) : null}
          <p className="font-display text-xs uppercase tracking-wider text-copy/60">
            Mini-level {position.miniLevel}
            {position.theme ? (
              <>
                {" · "}
                <span lang="de" className="normal-case tracking-normal text-copy/60">
                  {position.theme}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* A visible handle on the same door "weiter" opens. It goes through
              the ordinary send path on purpose: the server owns the move, and
              the tutor answers from the new level in the same breath. */}
          <button
            type="button"
            onClick={() => void send("Weiter bitte!", { restoreOnFailure: false })}
            disabled={sending}
            aria-label="Move on to the next mini-level"
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs",
              "uppercase tracking-wider text-copy/70 transition-colors hover:text-brand",
              "disabled:pointer-events-none disabled:opacity-50",
              focusRing,
            )}
          >
            Next mini-level →
          </button>

          {canSpeak ? (
            <button
              type="button"
              onClick={() => setReadAloud((on) => !on)}
              aria-pressed={readAloud}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs",
                "uppercase tracking-wider transition-colors",
                readAloud ? "text-brand" : "text-copy/70 hover:text-copy",
                focusRing,
              )}
            >
              <SpeakerIcon speaking={readAloud} />
              Read replies aloud
            </button>
          ) : null}

          {/* Some learners want the score in view; some find a falling bar
              louder than the tutor. Their call, remembered on this device. */}
          <button
            type="button"
            onClick={toggleMastery}
            aria-pressed={showMastery}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs",
              "uppercase tracking-wider transition-colors",
              showMastery ? "text-brand" : "text-copy/70 hover:text-copy",
              focusRing,
            )}
          >
            Show progress
          </button>
        </div>
      </header>

      {showMastery ? (
        <MasteryProgress
          tally={{ turns: tally.turns, strongTurns: tally.strongTurns }}
          lastTurn={lastTurn}
          threshold={masteryThreshold}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* An empty thread with nothing but a text box reads as broken. The
            invitation is in German and short enough to answer. */}
        {messages.length === 0 && streaming.length === 0 ? (
          <div className="m-auto flex max-w-xs flex-col gap-2 text-center">
            <p className="text-copy/45">
              {TUTOR.name} is waiting. Say anything —{" "}
              <span lang="de" className="text-copy/70">
                Hallo!
              </span>{" "}
              is enough to start.
            </p>
            <p className="text-xs text-copy/60">
              Nothing you say here is stored. What you learn is.
            </p>
          </div>
        ) : null}

        {/* Polite, so a finished reply is read once when it lands. The
            in-progress bubble below opts out: before the stream was fixed this
            region changed once per turn, and now it changes once per chunk,
            which is a screen reader reading the same half-sentence twenty
            times. */}
        <ol className="mt-auto flex flex-col gap-3" aria-live="polite">
          {messages.map((message) =>
            message.role === "milestone" ? (
              // The conversation crossing into a new level, drawn as a seam
              // in the flow so the transition is visible in the transcript
              // itself, not only in the header.
              <li
                key={message.id}
                data-role="milestone"
                className="flex items-center gap-3 py-1 font-display text-xs uppercase tracking-wider text-brand/90"
              >
                <span aria-hidden className="h-px flex-1 bg-brand/30" />
                <span>
                  Moving up — Mini-level {message.miniLevel}
                  {message.theme ? (
                    <>
                      {" · "}
                      <span lang="de" className="normal-case tracking-normal">
                        {message.theme}
                      </span>
                    </>
                  ) : null}
                </span>
                <span aria-hidden className="h-px flex-1 bg-brand/30" />
              </li>
            ) : message.role === "user" ? (
              <li
                key={message.id}
                data-role="user"
                className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-brand px-4 py-2.5 leading-relaxed text-on-accent"
              >
                {message.content}
              </li>
            ) : (
              <li
                key={message.id}
                data-role="assistant"
                className="flex max-w-[85%] items-end gap-1.5 self-start"
              >
                <span
                  lang="de"
                  className="rounded-2xl rounded-bl-md border border-edge/70 bg-panel px-4 py-2.5 leading-relaxed text-copy"
                >
                  <RichText content={message.content} />
                </span>
                <button
                  type="button"
                  onClick={() => void speak(message)}
                  aria-label={
                    speakingId === message.id
                      ? "Stop reading this reply"
                      : "Read this reply aloud"
                  }
                  aria-pressed={speakingId === message.id}
                  className={cn(
                    "shrink-0 rounded-full p-1.5 text-copy/60 transition-colors hover:text-brand",
                    speakingId === message.id && "text-brand",
                    focusRing,
                  )}
                >
                  <SpeakerIcon speaking={speakingId === message.id} />
                </button>
              </li>
            ),
          )}
          {streaming ? (
            <li
              data-role="assistant"
              data-streaming="true"
              aria-live="off"
              lang="de"
              className="max-w-[85%] self-start rounded-2xl rounded-bl-md border border-brand/40 bg-panel px-4 py-2.5 leading-relaxed text-copy"
            >
              {/* Formatted as it arrives, so the reply does not visibly
                  reflow the moment it finishes. A marker whose closer has not
                  landed yet is still just the characters it is. */}
              <RichText content={streaming} />
            </li>
          ) : null}
        </ol>
      </div>

      {/* The gate is open, and it is the learner's to walk through. Mastery
          moves nobody by itself: this says the level is cleared and offers
          the move, and "keep practising" is a real answer — the tutor will
          happily stay. A status region, so the news is read out once. */}
      {hasMastered(tally, thresholdRatio(masteryThreshold)) &&
      offerDeclinedFor !== tally.miniLevel ? (
        <section
          role="status"
          aria-label="Mini-level cleared"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3"
        >
          <p className="min-w-40 flex-1 text-sm leading-relaxed text-copy">
            <span className="font-display font-semibold text-brand">
              Mini-level {tally.miniLevel} cleared!
            </span>{" "}
            At least {masteryThreshold}% of your turns were error-free — the
            bar you set. Move up now, or keep practising as long as you like.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void send("Weiter bitte!", { restoreOnFailure: false })}
              disabled={sending}
              className={cn(buttonPrimary, "px-4 py-1.5 text-sm")}
            >
              Move on
            </button>
            <button
              type="button"
              onClick={() => setOfferDeclinedFor(tally.miniLevel)}
              className={cn(buttonQuiet, "px-4 py-1.5 text-xs")}
            >
              Keep practising
            </button>
          </div>
        </section>
      ) : null}

      {/* What the companion is doing, for somebody who cannot see it. One
          sentence for the whole wait rather than one per state: the reply
          itself is announced when it arrives, and this only has to say that
          one is coming. */}
      <p role="status" className="sr-only">
        {sending || streaming ? `${TUTOR.name} is replying.` : ""}
      </p>

      {/* Voice is an addition to the conversation, not the conversation. Its
          failures are said quietly, beside the control that caused them, and
          never as the red banner that means "your turn did not happen". */}
      {micNotice ?? voiceNotice ? (
        <p role="status" className="px-1 text-xs text-copy/60">
          {micNotice ?? voiceNotice}
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

      <form
        className="sticky bottom-0 flex items-center gap-3 border-t border-edge/60 bg-ground/95 py-4 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (message.length === 0 || sending) return;

          setDraft("");
          void send(message);
        }}
      >
        {canRecord ? (
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={sending || transcribing}
            aria-label={recording ? "Stop recording" : "Speak your message"}
            aria-pressed={recording}
            className={cn(
              "shrink-0 rounded-full border p-2.5 transition-colors",
              recording
                ? "animate-pulse border-ember bg-ember/20 text-ember"
                : "border-edge text-copy/60 hover:border-brand/60 hover:text-brand",
              "disabled:pointer-events-none disabled:opacity-50",
              focusRing,
            )}
          >
            <MicIcon />
          </button>
        ) : null}

        <input
          ref={inputRef}
          name="message"
          aria-label="Your message in German"
          placeholder="Schreib auf Deutsch…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          lang="de"
          className={cn(field, "flex-1")}
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className={cn(buttonPrimary, "px-5 py-2.5")}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
